import {
  decodeSmartText,
  latin1Decoder,
  sanitizeString,
  textEncoder,
  utf16beDecoder,
  utf16leDecoder,
} from "../binary.js";
import {
  EXIF_SUBIFD_IDS,
  EXIF_TAGS,
  GPS_TAGS,
  TIFF_IMAGE_STRUCT_TAGS,
} from "./exif-tags.js";
import { extractXmpAttributes } from "./xmp-parser.js";

const MAX_UINT32 = 0xffffffff;
const JPEG_MAX_EXIF_TIFF_BYTES = 65527; // 65535 - 2 (len) - 6 ("Exif\0\0")

const TIFF_TYPE_SIZES = Object.freeze({
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
});

const parseIntegerList = (str) => {
  const parts = str
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
  return parts.length > 0 ? parts : [0];
};

export function parseRationalPair(strPart) {
  const s = String(strPart).trim();
  const fracMatch = s.match(/^(\d+)\s*\/\s*(\d+)/);
  if (fracMatch) {
    const num = Math.min(MAX_UINT32, Number.parseInt(fracMatch[1], 10));
    const den = Math.min(MAX_UINT32, Number.parseInt(fracMatch[2], 10));
    return [num, den === 0 ? 1 : den];
  }
  const numMatch = s.match(/[-+]?\d*\.?\d+/);
  const val = numMatch ? Math.abs(Number.parseFloat(numMatch[0])) : 0;
  if (!Number.isFinite(val) || val === 0) return [0, 1];
  if (Number.isInteger(val)) return [Math.min(MAX_UINT32, val), 1];
  if (val < 1) {
    const recip = Math.round(1 / val);
    if (
      recip > 0 &&
      recip <= MAX_UINT32 &&
      Math.abs(1 / recip - val) < 0.0005
    ) {
      return [1, recip];
    }
  }
  let scale = 10000;
  while (scale > 1 && Math.round(val * scale) > MAX_UINT32) {
    scale = Math.floor(scale / 10);
  }
  return [Math.min(MAX_UINT32, Math.round(val * scale)), scale];
}

export function decimalToDMSRationals(dec) {
  const abs = Math.abs(Number(dec) || 0);
  let deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  let min = Math.floor(minFloat);
  let sec = Math.round((minFloat - min) * 60 * 10000);
  if (sec >= 600000) {
    sec = 0;
    min += 1;
  }
  if (min >= 60) {
    min = 0;
    deg += 1;
  }
  return [
    [deg, 1],
    [min, 1],
    [sec, 10000],
  ];
}

export function encodeExifFieldData(numId, strVal, targetType, le = true) {
  const valStr = String(strVal ?? "").trim();

  // Windows XP tags (0x9C9B..0x9C9F) are always UTF-16LE per spec
  if (numId >= 0x9c9b && numId <= 0x9c9f) {
    const buf = new Uint8Array((valStr.length + 1) * 2);
    for (let i = 0; i < valStr.length; i++) {
      const code = valStr.charCodeAt(i);
      buf[i * 2] = code & 0xff;
      buf[i * 2 + 1] = (code >> 8) & 0xff;
    }
    return { type: 1, count: buf.length, bytes: buf };
  }

  if (targetType === 3) {
    const nums = parseIntegerList(valStr);
    const buf = new ArrayBuffer(nums.length * 2);
    const v = new DataView(buf);
    for (let i = 0; i < nums.length; i++) {
      v.setUint16(i * 2, Math.max(0, Math.min(65535, nums[i])), le);
    }
    return { type: 3, count: nums.length, bytes: new Uint8Array(buf) };
  }

  if (targetType === 4) {
    const nums = parseIntegerList(valStr);
    const buf = new ArrayBuffer(nums.length * 4);
    const v = new DataView(buf);
    for (let i = 0; i < nums.length; i++) {
      v.setUint32(i * 4, Math.max(0, nums[i]) >>> 0, le);
    }
    return { type: 4, count: nums.length, bytes: new Uint8Array(buf) };
  }

  if (targetType === 5) {
    const cleanVal = valStr.replace(/\s*\([^)]*\)\s*$/, "");
    const rawParts = cleanVal.includes(",") ? cleanVal.split(",") : [cleanVal];
    const pairs = rawParts.map(parseRationalPair);
    const buf = new ArrayBuffer(pairs.length * 8);
    const v = new DataView(buf);
    for (let idx = 0; idx < pairs.length; idx++) {
      const [num, den] = pairs[idx];
      v.setUint32(idx * 8, num >>> 0, le);
      v.setUint32(idx * 8 + 4, den >>> 0, le);
    }
    return { type: 5, count: pairs.length, bytes: new Uint8Array(buf) };
  }

  if (targetType === 7 && numId === 0x9286) {
    let isAscii = true;
    for (let i = 0; i < valStr.length; i++) {
      if (valStr.charCodeAt(i) > 0x7f) {
        isAscii = false;
        break;
      }
    }
    if (isAscii) {
      const textBytes = textEncoder.encode(valStr);
      const u8 = new Uint8Array(8 + textBytes.length);
      u8.set([0x41, 0x53, 0x43, 0x49, 0x49, 0x00, 0x00, 0x00], 0);
      u8.set(textBytes, 8);
      return { type: 7, count: u8.length, bytes: u8 };
    }
    const u8 = new Uint8Array(8 + valStr.length * 2);
    u8.set([0x55, 0x4e, 0x49, 0x43, 0x4f, 0x44, 0x45, 0x00], 0);
    for (let i = 0; i < valStr.length; i++) {
      const c = valStr.charCodeAt(i);
      if (le) {
        u8[8 + i * 2] = c & 0xff;
        u8[8 + i * 2 + 1] = (c >> 8) & 0xff;
      } else {
        u8[8 + i * 2] = (c >> 8) & 0xff;
        u8[8 + i * 2 + 1] = c & 0xff;
      }
    }
    return { type: 7, count: u8.length, bytes: u8 };
  }

  const encoded = textEncoder.encode(`${valStr}\0`);
  return { type: 2, count: encoded.length, bytes: encoded };
}

export function buildCustomTiffPayload(
  tagsList,
  defaultOrient = 1,
  thumbnailBytesToKeep = null
) {
  const ifd0Map = new Map();
  const exifMap = new Map();
  const gpsMap = new Map();
  let orientationVal = defaultOrient || 1;
  let customGpsLocStr = null;

  for (const tag of tagsList || []) {
    if (!tag) continue;
    if (tag.id === "0x0112" || tag.label?.includes("Orientation")) {
      const parsed = Number.parseInt(tag.value, 10);
      if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 8) {
        orientationVal = parsed;
      }
      continue;
    }
    if (
      tag.id === "IFD1:THUMB" ||
      tag.id === "JFIF:THUMB" ||
      tag.id === "ICC" ||
      tag.id === "ICCP" ||
      tag.id === "iCCP" ||
      tag.id === "XMP" ||
      tag.id === "IPTC"
    ) {
      continue;
    }
    if (tag.id === "GPS:LOC") {
      customGpsLocStr = String(tag.value || "");
      continue;
    }

    let numId = null;
    if (typeof tag.id === "string" && tag.id.startsWith("0x")) {
      numId = Number.parseInt(tag.id, 16);
    } else {
      for (const [k, v] of Object.entries(EXIF_TAGS)) {
        if (v.label.toLowerCase() === String(tag.label || "").toLowerCase()) {
          numId = Number.parseInt(k, 10);
          break;
        }
      }
    }
    if (!numId || Number.isNaN(numId) || numId <= 0 || numId > 0xffff) {
      if (tag.id === "XMP:Tool" && !ifd0Map.has(0x0131)) numId = 0x0131;
      else if (tag.id === "XMP:Author" && !ifd0Map.has(0x013b)) numId = 0x013b;
      else if (tag.id === "XMP:RawFile" && !ifd0Map.has(0x010e)) numId = 0x010e;
      else if (tag.id === "XMP:Serial" && !exifMap.has(0xa431)) numId = 0xa431;
      else if (tag.id === "XMP:Lens" && !exifMap.has(0xa434)) numId = 0xa434;
      else if (tag.id === "COM" && !exifMap.has(0x9286)) numId = 0x9286;
      else continue;
    }
    if (numId === 0x8769 || numId === 0x8825) continue;

    const isGpsTag =
      tag.ifd === "GPS" || (tag.category === "Geolocation" && numId <= 0x001f);
    if (isGpsTag) {
      const gpsMeta = GPS_TAGS[numId] || { type: 2 };
      const targetType =
        !tag.edited && tag.rawType ? tag.rawType : gpsMeta.type;
      gpsMap.set(numId, {
        id: numId,
        ...encodeExifFieldData(numId, tag.value, targetType, true),
      });
    } else {
      const exifMeta = EXIF_TAGS[numId];
      const isSubExif =
        tag.ifd === "EXIF" ||
        EXIF_SUBIFD_IDS.has(numId) ||
        (exifMeta && exifMeta.ifd === "EXIF");
      const targetType = exifMeta
        ? exifMeta.type
        : tag.rawType && !tag.edited
          ? tag.rawType
          : 2;
      const encodedEntry = {
        id: numId,
        ...encodeExifFieldData(numId, tag.value, targetType, true),
      };
      if (isSubExif) exifMap.set(numId, encodedEntry);
      else ifd0Map.set(numId, encodedEntry);
    }
  }

  const orientBuf = new Uint8Array(2);
  new DataView(orientBuf.buffer).setUint16(0, orientationVal, true);
  ifd0Map.set(0x0112, {
    id: 0x0112,
    type: 3,
    count: 1,
    bytes: orientBuf,
  });

  if (customGpsLocStr) {
    const m = customGpsLocStr.match(
      /([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)/
    );
    if (m) {
      const lat = Number.parseFloat(m[1]);
      const lon = Number.parseFloat(m[2]);
      if (!(Number.isNaN(lat) || Number.isNaN(lon))) {
        gpsMap.set(0x0001, {
          id: 0x0001,
          type: 2,
          count: 2,
          bytes: new Uint8Array([(lat >= 0 ? "N" : "S").charCodeAt(0), 0]),
        });
        gpsMap.set(0x0003, {
          id: 0x0003,
          type: 2,
          count: 2,
          bytes: new Uint8Array([(lon >= 0 ? "E" : "W").charCodeAt(0), 0]),
        });
        const writeDmsBuf = (dec) => {
          const buf = new ArrayBuffer(24);
          const v = new DataView(buf);
          const dmsList = decimalToDMSRationals(dec);
          for (let i = 0; i < dmsList.length; i++) {
            const [n, d] = dmsList[i];
            v.setUint32(i * 8, n, true);
            v.setUint32(i * 8 + 4, d, true);
          }
          return new Uint8Array(buf);
        };
        gpsMap.set(0x0002, {
          id: 0x0002,
          type: 5,
          count: 3,
          bytes: writeDmsBuf(lat),
        });
        gpsMap.set(0x0004, {
          id: 0x0004,
          type: 5,
          count: 3,
          bytes: writeDmsBuf(lon),
        });
      }
    }
  }

  const hasExifSub = exifMap.size > 0;
  const hasGpsSub = gpsMap.size > 0;
  const hasThumb = !!(thumbnailBytesToKeep && thumbnailBytesToKeep.length > 0);
  if (hasExifSub) {
    ifd0Map.set(0x8769, {
      id: 0x8769,
      type: 4,
      count: 1,
      bytes: new Uint8Array(4),
      isSubPtr: "EXIF",
    });
  }
  if (hasGpsSub) {
    ifd0Map.set(0x8825, {
      id: 0x8825,
      type: 4,
      count: 1,
      bytes: new Uint8Array(4),
      isSubPtr: "GPS",
    });
  }

  const ifd0List = Array.from(ifd0Map.values()).sort((a, b) => a.id - b.id);
  const exifList = Array.from(exifMap.values()).sort((a, b) => a.id - b.id);
  const gpsList = Array.from(gpsMap.values()).sort((a, b) => a.id - b.id);

  const calcIfdSpace = (list) => {
    if (!list.length) return { dirSize: 0, heapSize: 0 };
    let heapSize = 0;
    for (const item of list) {
      if (item.bytes.length > 4) {
        heapSize += item.bytes.length + (item.bytes.length % 2);
      }
    }
    return { dirSize: 2 + list.length * 12 + 4, heapSize };
  };

  const s0 = calcIfdSpace(ifd0List);
  const sExif = calcIfdSpace(exifList);
  const sGps = calcIfdSpace(gpsList);
  const sIfd1 = hasThumb
    ? {
        dirSize: 30,
        heapSize:
          thumbnailBytesToKeep.length + (thumbnailBytesToKeep.length % 2),
      }
    : { dirSize: 0, heapSize: 0 };

  const totalSize =
    8 +
    s0.dirSize +
    s0.heapSize +
    sExif.dirSize +
    sExif.heapSize +
    sGps.dirSize +
    sGps.heapSize +
    sIfd1.dirSize +
    sIfd1.heapSize;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 0x002a, true);
  view.setUint32(4, 8, true);

  let cursor = 8 + s0.dirSize + s0.heapSize;
  const exifIfdOffset = hasExifSub ? cursor : 0;
  if (hasExifSub) cursor += sExif.dirSize + sExif.heapSize;
  const gpsIfdOffset = hasGpsSub ? cursor : 0;
  if (hasGpsSub) cursor += sGps.dirSize + sGps.heapSize;
  const ifd1Offset = hasThumb ? cursor : 0;

  const writeDir = (baseOffset, list, nextIfdPtr = 0) => {
    view.setUint16(baseOffset, list.length, true);
    let heapCursor = baseOffset + 2 + list.length * 12 + 4;
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      const pos = baseOffset + 2 + i * 12;
      view.setUint16(pos, entry.id, true);
      view.setUint16(pos + 2, entry.type, true);
      view.setUint32(pos + 4, entry.count, true);
      if (entry.isSubPtr === "EXIF") {
        view.setUint32(pos + 8, exifIfdOffset, true);
      } else if (entry.isSubPtr === "GPS") {
        view.setUint32(pos + 8, gpsIfdOffset, true);
      } else if (entry.bytes.length <= 4) {
        u8.set(entry.bytes, pos + 8);
      } else {
        view.setUint32(pos + 8, heapCursor, true);
        u8.set(entry.bytes, heapCursor);
        heapCursor += entry.bytes.length + (entry.bytes.length % 2);
      }
    }
    view.setUint32(baseOffset + 2 + list.length * 12, nextIfdPtr, true);
  };

  writeDir(8, ifd0List, ifd1Offset);
  if (hasExifSub) writeDir(exifIfdOffset, exifList, 0);
  if (hasGpsSub) writeDir(gpsIfdOffset, gpsList, 0);
  if (hasThumb) {
    const thumbDataOffset = ifd1Offset + 30;
    view.setUint16(ifd1Offset, 2, true);
    view.setUint16(ifd1Offset + 2, 0x0201, true);
    view.setUint16(ifd1Offset + 4, 4, true);
    view.setUint32(ifd1Offset + 6, 1, true);
    view.setUint32(ifd1Offset + 10, thumbDataOffset, true);
    view.setUint16(ifd1Offset + 14, 0x0202, true);
    view.setUint16(ifd1Offset + 16, 4, true);
    view.setUint32(ifd1Offset + 18, 1, true);
    view.setUint32(ifd1Offset + 22, thumbnailBytesToKeep.length, true);
    view.setUint32(ifd1Offset + 26, 0, true);
    u8.set(thumbnailBytesToKeep, thumbDataOffset);
  }
  return u8;
}

export function buildCustomExifApp1(
  tagsList,
  defaultOrient = 1,
  thumbnailBytesToKeep = null
) {
  let tiffBytes = buildCustomTiffPayload(
    tagsList,
    defaultOrient,
    thumbnailBytesToKeep
  );
  if (tiffBytes.length > JPEG_MAX_EXIF_TIFF_BYTES && thumbnailBytesToKeep) {
    tiffBytes = buildCustomTiffPayload(tagsList, defaultOrient, null);
  }
  if (tiffBytes.length > JPEG_MAX_EXIF_TIFF_BYTES) {
    throw new Error("EXIF metadata exceeds JPEG 64 KB APP1 segment limit");
  }
  const u8 = new Uint8Array(10 + tiffBytes.length);
  const view = new DataView(u8.buffer);
  view.setUint16(0, 0xffe1, false);
  view.setUint16(2, u8.length - 2, false);
  u8.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);
  u8.set(tiffBytes, 10);
  return u8;
}

export function parseExifBuffer(
  uint8,
  view,
  tiffStart,
  maxSegmentEnd,
  recordLocations = false
) {
  const result = {
    tags: [],
    gps: null,
    orientation: null,
    thumbnailBytes: null,
    width: 0,
    height: 0,
    littleEndian: true,
    locations: [],
  };
  try {
    if (tiffStart + 8 > view.byteLength) return result;
    const byteOrder = view.getUint16(tiffStart, false);
    let le;
    if (byteOrder === 0x4949) le = true;
    else if (byteOrder === 0x4d4d) le = false;
    else return result;
    result.littleEndian = le;

    const magic = view.getUint16(tiffStart + 2, le);
    if (
      magic !== 0x002a &&
      magic !== 0x4f52 &&
      magic !== 0x5352 &&
      magic !== 0x0055
    ) {
      return result;
    }

    const ifd0Offset = view.getUint32(tiffStart + 4, le);
    let exifIFDOffset = null;
    let gpsIFDOffset = null;
    const subIfds = [];

    function readIFDValue(type, count, valueOffset, tagId = 0) {
      if (count === 0) return null;
      const unitSize = TIFF_TYPE_SIZES[type] || 1;
      const totalBytes = unitSize * count;
      let dataPos;
      if (totalBytes <= 4) {
        dataPos = valueOffset;
      } else {
        const relOff = view.getUint32(valueOffset, le);
        if (relOff < 8) return null;
        dataPos = tiffStart + relOff;
      }
      if (dataPos < 0 || dataPos + totalBytes > view.byteLength) return null;

      if (type === 2) {
        const rawBytes = uint8.subarray(dataPos, dataPos + Math.max(0, count));
        const nulIdx = rawBytes.indexOf(0);
        const trimmed = nulIdx === -1 ? rawBytes : rawBytes.subarray(0, nulIdx);
        return sanitizeString(decodeSmartText(trimmed));
      }
      if (type === 3) {
        if (count === 1) return view.getUint16(dataPos, le);
        const arr = [];
        for (let i = 0; i < Math.min(count, 8); i++) {
          arr.push(view.getUint16(dataPos + i * 2, le));
        }
        return arr;
      }
      if (type === 4 || type === 13) {
        if (count === 1) return view.getUint32(dataPos, le);
        const arr = [];
        for (let i = 0; i < Math.min(count, 8); i++) {
          arr.push(view.getUint32(dataPos + i * 4, le));
        }
        return arr;
      }
      if (type === 5 || type === 10) {
        const readRat = (pos) => {
          const num =
            type === 10 ? view.getInt32(pos, le) : view.getUint32(pos, le);
          const den =
            type === 10
              ? view.getInt32(pos + 4, le)
              : view.getUint32(pos + 4, le);
          return den === 0 ? 0 : num / den;
        };
        if (count === 1) {
          const v = readRat(dataPos);
          if (v === 0) return "0";
          if (tagId === 0x829a && v > 0 && v < 1) {
            return `1/${Math.round(1 / v)} (${v.toFixed(4)})`;
          }
          return Number.isInteger(v) ? String(v) : v.toFixed(2);
        }
        const rats = [];
        for (let i = 0; i < Math.min(count, 4); i++) {
          rats.push(readRat(dataPos + i * 8));
        }
        return rats;
      }
      if (type === 1 || type === 6) {
        const raw = uint8.subarray(dataPos, dataPos + totalBytes);
        if (tagId >= 0x9c9b && tagId <= 0x9c9f) {
          return sanitizeString(utf16leDecoder.decode(raw));
        }
        if (count <= 8) return Array.from(raw);
        return `<Binary payload ${totalBytes} B>`;
      }
      if (type === 8 || type === 9 || type === 11 || type === 12) {
        const rd = (p) =>
          type === 8
            ? view.getInt16(p, le)
            : type === 9
              ? view.getInt32(p, le)
              : type === 11
                ? view.getFloat32(p, le)
                : view.getFloat64(p, le);
        const arr = [];
        for (let i = 0; i < Math.min(count, 8); i++) {
          arr.push(rd(dataPos + i * unitSize));
        }
        return count === 1 ? arr[0] : arr;
      }
      if (type === 7) {
        const rawSlice = uint8.subarray(dataPos, dataPos + totalBytes);
        if (rawSlice.length >= 8) {
          const prefix = latin1Decoder.decode(rawSlice.subarray(0, 8));
          if (prefix.startsWith("ASCII")) {
            const text = sanitizeString(decodeSmartText(rawSlice.subarray(8)));
            return text || `<Binary payload ${totalBytes} B>`;
          }
          if (prefix.startsWith("UNICODE")) {
            const body = rawSlice.subarray(8);
            const dec =
              body.length >= 2 && body[0] === 0xfe && body[1] === 0xff
                ? utf16beDecoder
                : body.length >= 2 && body[0] === 0xff && body[1] === 0xfe
                  ? utf16leDecoder
                  : le
                    ? utf16leDecoder
                    : utf16beDecoder;
            const text = sanitizeString(dec.decode(body));
            return text || `<Binary payload ${totalBytes} B>`;
          }
        }
        const cleaned = sanitizeString(decodeSmartText(rawSlice));
        return cleaned.length >= 1 &&
          /^[\x20-\x7e\u00a0-\uffff\s]+$/.test(cleaned)
          ? cleaned
          : `<Binary payload ${totalBytes} B>`;
      }
      return null;
    }

    function parseIFD(dirOffset, mode = "IFD0") {
      const absDir = tiffStart + dirOffset;
      if (absDir + 2 > view.byteLength) return 0;
      const entriesCount = view.getUint16(absDir, le);
      if (
        recordLocations &&
        (entriesCount > 4096 ||
          absDir + 2 + entriesCount * 12 > view.byteLength)
      ) {
        throw new Error("Damaged TIFF: directory exceeds file size");
      }
      if (!recordLocations && entriesCount > 300) return 0;

      const gpsRaw = {};
      let thumbOffset = 0;
      let thumbLength = 0;

      const recordTag = (
        hexId,
        meta,
        ifdName,
        type,
        val,
        entryPos,
        dataPos,
        totalBytes,
        isGps = false
      ) => {
        result.tags.push({
          id: hexId,
          label: meta.label,
          category: meta.cat,
          privacy: meta.privacy ?? true,
          ifd: ifdName,
          rawType: type,
          value: Array.isArray(val) ? val.join(", ") : String(val),
        });
        if (recordLocations && (!isGps ? hexId !== "0x0112" : true)) {
          const loc = { id: hexId, entryPos, dataPos, totalBytes, type, le };
          if (isGps) loc.isGps = true;
          result.locations.push(loc);
        }
      };

      for (let i = 0; i < entriesCount; i++) {
        const entryPos = absDir + 2 + i * 12;
        if (entryPos + 12 > view.byteLength) break;

        const tagId = view.getUint16(entryPos, le);
        const type = view.getUint16(entryPos + 2, le);
        const count = view.getUint32(entryPos + 4, le);
        const valOffsetPos = entryPos + 8;
        if (
          recordLocations &&
          (type < 1 || type > 18 || type === 14 || type === 15)
        ) {
          throw new Error("Damaged TIFF: invalid field type");
        }
        if (count === 0) continue;
        const totalBytes = (TIFF_TYPE_SIZES[type] || 1) * count;
        const dataPos =
          totalBytes <= 4
            ? valOffsetPos
            : tiffStart + view.getUint32(valOffsetPos, le);

        if (tagId === 0x0201 || tagId === 0x0202) {
          const ptrVal = view.getUint32(valOffsetPos, le);
          if (tagId === 0x0201) thumbOffset = ptrVal;
          else thumbLength = ptrVal;
          if (recordLocations) {
            result.locations.push({
              id: "IFD1:THUMB",
              entryPos,
              dataPos: 0,
              totalBytes: 0,
              isThumbPtr: true,
            });
          }
          if (mode === "IFD1") continue;
        }
        if (mode === "IFD1") continue;

        if (mode === "IFD0") {
          const numVal =
            type === 3
              ? view.getUint16(valOffsetPos, le)
              : view.getUint32(valOffsetPos, le);
          if (tagId === 0x0100 && numVal > 0) result.width = numVal;
          if (tagId === 0x0101 && numVal > 0) result.height = numVal;
        }

        if (mode === "GPS") {
          const val = readIFDValue(type, count, valOffsetPos, tagId);
          gpsRaw[tagId] = val;
          const gpsMeta = GPS_TAGS[tagId] || {
            label: `GPS 0x${tagId.toString(16).toUpperCase().padStart(4, "0")}`,
            cat: "Geolocation",
            privacy: true,
          };
          if (val !== null && val !== "") {
            const hexId = `0x${tagId.toString(16).toUpperCase().padStart(4, "0")}`;
            recordTag(
              hexId,
              gpsMeta,
              "GPS",
              type,
              val,
              entryPos,
              dataPos,
              totalBytes,
              true
            );
          }
        } else {
          if (tagId === 0x8769) {
            exifIFDOffset = view.getUint32(valOffsetPos, le);
            continue;
          }
          if (tagId === 0x8825) {
            gpsIFDOffset = view.getUint32(valOffsetPos, le);
            continue;
          }
          if (
            tagId === 0x02bc &&
            dataPos > 0 &&
            dataPos + totalBytes <= uint8.length
          ) {
            const xmpSlice = uint8.subarray(dataPos, dataPos + totalBytes);
            result.tags.push(...extractXmpAttributes(xmpSlice));
            result.tags.push({
              id: "XMP",
              label: "Embedded XMP Packet",
              category: "Software",
              privacy: true,
              value: `${totalBytes} B`,
            });
            if (recordLocations) {
              result.locations.push({
                id: "XMP",
                entryPos,
                dataPos,
                totalBytes,
                type,
                le,
              });
            }
            continue;
          }
          if (recordLocations && tagId === 0x014a) {
            const nSub = Math.min(count, 8);
            const base = totalBytes <= 4 ? valOffsetPos : dataPos;
            for (
              let k = 0;
              k < nSub && base + k * 4 + 4 <= view.byteLength;
              k++
            ) {
              const off = view.getUint32(base + k * 4, le);
              if (off > 0) subIfds.push(off);
            }
            continue;
          }
          if (
            recordLocations &&
            tagId === 0x8773 &&
            dataPos > 0 &&
            dataPos + totalBytes <= uint8.length
          ) {
            result.tags.push({
              id: "ICC",
              label: "ICC Color Profile",
              category: "Profile",
              privacy: false,
              value: `${totalBytes} B (Kept)`,
            });
            result.locations.push({
              id: "ICC",
              entryPos,
              dataPos,
              totalBytes,
              type,
              le,
            });
            continue;
          }
          if (
            recordLocations &&
            (TIFF_IMAGE_STRUCT_TAGS.has(tagId) ||
              (tagId >= 0x7000 && tagId <= 0x7fff)) &&
            tagId !== 0x0112
          ) {
            continue;
          }

          const val = readIFDValue(type, count, valOffsetPos, tagId);
          if (tagId === 0x0112 && typeof val === "number") {
            result.orientation = val;
          }

          const meta = EXIF_TAGS[tagId] || {
            label: `Tag 0x${tagId.toString(16).toUpperCase().padStart(4, "0")}`,
            cat: mode === "EXIF" ? "Optics" : "Hardware",
            privacy: true,
          };
          if (val !== null && val !== "") {
            const hexId = `0x${tagId.toString(16).toUpperCase().padStart(4, "0")}`;
            recordTag(
              hexId,
              meta,
              mode,
              type,
              val,
              entryPos,
              dataPos,
              totalBytes
            );
          }
        }
      }

      if (!result.thumbnailBytes && thumbOffset > 0 && thumbLength > 0) {
        const absStart = tiffStart + thumbOffset;
        const absEnd = Math.min(
          maxSegmentEnd || uint8.length,
          absStart + thumbLength
        );
        if (
          absStart + 4 < absEnd &&
          uint8[absStart] === 0xff &&
          uint8[absStart + 1] === 0xd8
        ) {
          result.thumbnailBytes = uint8.slice(absStart, absEnd);
          if (recordLocations) {
            result.locations.push({
              id: "IFD1:THUMB",
              entryPos: absDir,
              dataPos: absStart,
              totalBytes: absEnd - absStart,
            });
          }
        }
      }

      if (
        mode === "GPS" &&
        Array.isArray(gpsRaw[2]) &&
        Array.isArray(gpsRaw[4])
      ) {
        let lat =
          gpsRaw[2][0] + (gpsRaw[2][1] || 0) / 60 + (gpsRaw[2][2] || 0) / 3600;
        let lon =
          gpsRaw[4][0] + (gpsRaw[4][1] || 0) / 60 + (gpsRaw[4][2] || 0) / 3600;
        if (gpsRaw[1] === "S") lat = -lat;
        if (gpsRaw[3] === "W") lon = -lon;
        if (!(Number.isNaN(lat) || Number.isNaN(lon))) {
          result.gps = {
            lat: lat.toFixed(6),
            lon: lon.toFixed(6),
            alt: gpsRaw[6] ? `${gpsRaw[6]} m` : null,
          };
        }
      }

      const nextIfdPtrPos = absDir + 2 + entriesCount * 12;
      return nextIfdPtrPos + 4 <= view.byteLength
        ? view.getUint32(nextIfdPtrPos, le)
        : 0;
    }

    const ifd1Offset = parseIFD(ifd0Offset, "IFD0");
    if (exifIFDOffset) parseIFD(exifIFDOffset, "EXIF");
    if (gpsIFDOffset) parseIFD(gpsIFDOffset, "GPS");
    for (const so of subIfds.slice(0, 8)) parseIFD(so, "EXIF");
    if (ifd1Offset && ifd1Offset > 0) {
      if (recordLocations) {
        let nxt = ifd1Offset;
        const seenIfds = new Set([ifd0Offset]);
        for (let k = 0; k < 32 && nxt > 0 && !seenIfds.has(nxt); k++) {
          seenIfds.add(nxt);
          const pe = exifIFDOffset;
          const pg = gpsIFDOffset;
          exifIFDOffset = null;
          gpsIFDOffset = null;
          nxt = parseIFD(nxt, "EXIF");
          if (exifIFDOffset) parseIFD(exifIFDOffset, "EXIF");
          if (gpsIFDOffset) parseIFD(gpsIFDOffset, "GPS");
          exifIFDOffset = pe;
          gpsIFDOffset = pg;
        }
      } else {
        parseIFD(ifd1Offset, "IFD1");
      }
    }
  } catch (e) {
    if (recordLocations && String(e?.message || "").startsWith("Damaged")) {
      throw e;
    }
    if (import.meta.env?.DEV) console.warn("EXIF parse warning:", e);
  }
  return result;
}

export function computeExactTiffSpan(uint8, view, tiffStart) {
  const maxEnd = uint8.length;
  if (tiffStart + 8 > maxEnd) return 0;
  const order = view.getUint16(tiffStart, false);
  const le = order === 0x4949 ? true : order === 0x4d4d ? false : null;
  if (le === null || view.getUint16(tiffStart + 2, le) !== 0x002a) return 0;

  let maxReach = 8;
  const visited = new Set();
  const queue = [view.getUint32(tiffStart + 4, le)];

  while (queue.length > 0) {
    const relDir = queue.shift();
    if (!relDir || visited.has(relDir) || relDir >= 0x40000) continue;
    visited.add(relDir);
    const absDir = tiffStart + relDir;
    if (absDir + 2 > maxEnd) continue;
    const count = view.getUint16(absDir, le);
    if (count > 250) continue;
    const dirEndRel = relDir + 2 + count * 12 + 4;
    if (tiffStart + dirEndRel > maxEnd) continue;
    if (dirEndRel > maxReach) maxReach = dirEndRel;

    let tOff = 0;
    let tLen = 0;
    for (let i = 0; i < count; i++) {
      const ePos = absDir + 2 + i * 12;
      const tagId = view.getUint16(ePos, le);
      const type = view.getUint16(ePos + 2, le);
      const byteLen =
        (TIFF_TYPE_SIZES[type] || 1) * view.getUint32(ePos + 4, le);
      if (byteLen > 4) {
        const dataRel = view.getUint32(ePos + 8, le);
        if (
          dataRel > 0 &&
          dataRel + byteLen <= 0x40000 &&
          tiffStart + dataRel + byteLen <= maxEnd &&
          dataRel + byteLen > maxReach
        )
          maxReach = dataRel + byteLen;
      }
      if (tagId === 0x8769 || tagId === 0x8825 || tagId === 0xa005) {
        const subRel = view.getUint32(ePos + 8, le);
        if (subRel > 0 && subRel < 0x40000) queue.push(subRel);
      }
      if (tagId === 0x0201) tOff = view.getUint32(ePos + 8, le);
      if (tagId === 0x0202) tLen = view.getUint32(ePos + 8, le);
    }
    if (
      tOff > 0 &&
      tLen > 0 &&
      tOff + tLen <= 0x40000 &&
      tiffStart + tOff + tLen <= maxEnd &&
      tOff + tLen > maxReach
    )
      maxReach = tOff + tLen;
    const nextIfdRel = view.getUint32(absDir + 2 + count * 12, le);
    if (nextIfdRel > 0 && nextIfdRel < 0x40000) queue.push(nextIfdRel);
  }
  return maxReach;
}
