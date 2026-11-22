import { concatUint8Arrays, crc32, packResult } from "../../binary.js";
import { EXIF_TAGS } from "../exif-tags.js";
import {
  decimalToDMSRationals,
  encodeExifFieldData,
  parseExifBuffer,
} from "../tiff-codec.js";

const RAW_FORMAT_MAP = {
  ".dng": ["DNG", "image/x-adobe-dng"],
  ".cr2": ["CR2", "image/x-canon-cr2"],
  ".nef": ["NEF", "image/x-nikon-nef"],
  ".nrw": ["NRW", "image/x-nikon-nrw"],
  ".arw": ["ARW", "image/x-sony-arw"],
  ".sr2": ["SR2", "image/x-sony-sr2"],
  ".orf": ["ORF", "image/x-olympus-orf"],
  ".rw2": ["RW2", "image/x-panasonic-rw2"],
  ".pef": ["PEF", "image/x-pentax-pef"],
  ".srw": ["SRW", "image/x-samsung-srw"],
  ".3fr": ["3FR", "image/x-hasselblad-3fr"],
  ".fff": ["FFF", "image/x-hasselblad-fff"],
  ".rwl": ["RWL", "image/x-leica-rwl"],
  ".tif": ["TIFF", "image/tiff"],
  ".tiff": ["TIFF", "image/tiff"],
};

export function scrubTIFFAndRAW(uint8, view, fileName, options = {}) {
  const extMatch = (fileName.match(/\.[^.]+$/) || [".dng"])[0].toLowerCase();
  let [format, mime] = RAW_FORMAT_MAP[extMatch] || ["TIFF", "image/tiff"];
  const le = uint8[0] === 0x49;
  const magic = view.getUint16(2, le);

  if (magic === 0x4f52 || magic === 0x5352) {
    format = "ORF";
    mime = "image/x-olympus-orf";
  } else if (magic === 0x0055) {
    format = "RW2";
    mime = "image/x-panasonic-rw2";
  } else if (uint8.length >= 12 && uint8[8] === 0x43 && uint8[9] === 0x52) {
    format = "CR2";
    mime = "image/x-canon-cr2";
  }

  const parsed = parseExifBuffer(uint8, view, 0, uint8.length, true);
  const cleanedUint8 = uint8.slice();
  const cleanView = new DataView(cleanedUint8.buffer);
  const customTags = options.customTagsToInject || [];
  const keepMap = new Map(customTags.map((t) => [t.id, t]));
  const editedGpsLoc = keepMap.get("GPS:LOC");
  const appendedChunks = [];
  let appendedTailOffset = cleanedUint8.length + (cleanedUint8.length % 2);
  if (cleanedUint8.length % 2 === 1) appendedChunks.push(new Uint8Array(1));

  for (const loc of parsed.locations) {
    if (loc.id === "ICC" && options.keepICC) continue;
    const keptTag = keepMap.get(loc.id);
    if (!keptTag) {
      if (loc.isGps && editedGpsLoc) {
        if (editedGpsLoc.edited) {
          const coords = String(editedGpsLoc.value)
            .split(",")
            .map((s) => Number.parseFloat(s.trim()));
          if (
            coords.length >= 2 &&
            !Number.isNaN(coords[0]) &&
            !Number.isNaN(coords[1])
          ) {
            const [lat, lon] = coords;
            if (loc.id === "0x0001" && loc.dataPos + 2 <= cleanedUint8.length) {
              cleanedUint8[loc.dataPos] = lat >= 0 ? 78 : 83;
              cleanedUint8[loc.dataPos + 1] = 0;
            } else if (
              loc.id === "0x0003" &&
              loc.dataPos + 2 <= cleanedUint8.length
            ) {
              cleanedUint8[loc.dataPos] = lon >= 0 ? 69 : 87;
              cleanedUint8[loc.dataPos + 1] = 0;
            } else if (
              (loc.id === "0x0002" || loc.id === "0x0004") &&
              loc.totalBytes >= 24 &&
              loc.dataPos + 24 <= cleanedUint8.length
            ) {
              const dms = decimalToDMSRationals(
                loc.id === "0x0002" ? lat : lon
              );
              for (let r = 0; r < 3; r++) {
                cleanView.setUint32(loc.dataPos + r * 8, dms[r][0], loc.le);
                cleanView.setUint32(loc.dataPos + r * 8 + 4, dms[r][1], loc.le);
              }
            }
          }
        }
        continue;
      }
      if (
        loc.dataPos >= 8 &&
        loc.dataPos + loc.totalBytes <= cleanedUint8.length
      ) {
        cleanedUint8.fill(0, loc.dataPos, loc.dataPos + loc.totalBytes);
      }
      if (
        (loc.id !== "IFD1:THUMB" || loc.isThumbPtr) &&
        loc.entryPos + 12 <= cleanedUint8.length
      ) {
        cleanView.setUint32(loc.entryPos + 4, 0, le);
        cleanView.setUint32(loc.entryPos + 8, 0, le);
      }
    } else if (
      keptTag.edited &&
      loc.dataPos >= 8 &&
      loc.dataPos + loc.totalBytes <= cleanedUint8.length
    ) {
      const numId =
        Number.parseInt(String(loc.id).replace(/^0x/i, ""), 16) || 0x9286;
      const encField = encodeExifFieldData(numId, keptTag.value, loc.type, le);
      const neededBytes = encField.bytes.length;
      cleanedUint8.fill(0, loc.dataPos, loc.dataPos + loc.totalBytes);
      cleanView.setUint16(loc.entryPos + 2, encField.type, le);
      cleanView.setUint32(loc.entryPos + 4, encField.count, le);
      if (neededBytes <= 4) {
        cleanedUint8.fill(0, loc.entryPos + 8, loc.entryPos + 12);
        cleanedUint8.set(encField.bytes, loc.entryPos + 8);
      } else if (
        neededBytes <= loc.totalBytes &&
        loc.dataPos !== loc.entryPos + 8
      ) {
        cleanedUint8.set(encField.bytes, loc.dataPos);
      } else {
        const padLen = neededBytes + (neededBytes % 2);
        const chunk = new Uint8Array(padLen);
        chunk.set(encField.bytes, 0);
        cleanView.setUint32(loc.entryPos + 8, appendedTailOffset, le);
        appendedChunks.push(chunk);
        appendedTailOffset += padLen;
      }
    }
  }

  // Inject brand-new custom tags by relocating IFD0 to EOF without shifting sensor offsets
  const existingLocIds = new Set(parsed.locations.map((l) => l.id));
  const hasExistingGpsLoc = parsed.locations.some((l) => l.isGps);
  const newGpsForIfd = hasExistingGpsLoc
    ? null
    : customTags.find((t) => t.id === "GPS:LOC");
  const newCustomForIfd = customTags.filter(
    (t) =>
      !existingLocIds.has(t.id) &&
      t.ifd !== "GPS" &&
      /^0x[0-9a-fA-F]{1,4}$/.test(t.id) &&
      !["0x0112", "0x8769", "0x8825"].includes(t.id)
  );

  if (
    (newCustomForIfd.length > 0 || newGpsForIfd) &&
    cleanedUint8.length >= 8
  ) {
    const origIfd0Off = cleanView.getUint32(4, le);
    if (origIfd0Off > 0 && origIfd0Off + 2 <= cleanedUint8.length) {
      const origCount = cleanView.getUint16(origIfd0Off, le);
      if (
        origCount < 1024 &&
        origIfd0Off + 2 + origCount * 12 + 4 <= cleanedUint8.length
      ) {
        const nextIfdPtr = cleanView.getUint32(
          origIfd0Off + 2 + origCount * 12,
          le
        );
        let entries = [];
        for (let i = 0; i < origCount; i++) {
          const ep = origIfd0Off + 2 + i * 12;
          entries.push({
            tagId: cleanView.getUint16(ep, le),
            raw12: cleanedUint8.slice(ep, ep + 12),
          });
        }
        for (const ct of newCustomForIfd) {
          const numId = Number.parseInt(ct.id.slice(2), 16);
          const knownMeta = EXIF_TAGS[numId];
          const targetType = knownMeta?.type ? knownMeta.type : 2;
          const enc = encodeExifFieldData(numId, ct.value, targetType, le);
          const raw12 = new Uint8Array(12);
          const rv = new DataView(raw12.buffer);
          rv.setUint16(0, numId, le);
          rv.setUint16(2, enc.type, le);
          rv.setUint32(4, enc.count, le);
          if (enc.bytes.length <= 4) {
            raw12.set(enc.bytes, 8);
          } else {
            const padLen = enc.bytes.length + (enc.bytes.length % 2);
            const valChunk = new Uint8Array(padLen);
            valChunk.set(enc.bytes, 0);
            rv.setUint32(8, appendedTailOffset, le);
            appendedChunks.push(valChunk);
            appendedTailOffset += padLen;
          }
          entries = entries.filter((e) => e.tagId !== numId);
          entries.push({ tagId: numId, raw12 });
        }

        if (newGpsForIfd) {
          const gm = String(newGpsForIfd.value || "").match(
            /([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)/
          );
          if (gm) {
            const lat = Number.parseFloat(gm[1]);
            const lon = Number.parseFloat(gm[2]);
            if (!(Number.isNaN(lat) || Number.isNaN(lon))) {
              const gpsIfdSize = 2 + 4 * 12 + 4 + 48;
              const gpsBuf = new Uint8Array(gpsIfdSize);
              const gv = new DataView(gpsBuf.buffer);
              const latHeapOff = appendedTailOffset + 2 + 4 * 12 + 4;
              const lonHeapOff = latHeapOff + 24;
              gv.setUint16(0, 4, le);
              // 0x0001 LatRef
              gv.setUint16(2, 0x0001, le);
              gv.setUint16(4, 2, le);
              gv.setUint32(6, 2, le);
              gpsBuf[10] = (lat >= 0 ? "N" : "S").charCodeAt(0);
              gpsBuf[11] = 0;
              // 0x0002 Lat
              gv.setUint16(14, 0x0002, le);
              gv.setUint16(16, 5, le);
              gv.setUint32(18, 3, le);
              gv.setUint32(22, latHeapOff, le);
              // 0x0003 LonRef
              gv.setUint16(26, 0x0003, le);
              gv.setUint16(28, 2, le);
              gv.setUint32(30, 2, le);
              gpsBuf[34] = (lon >= 0 ? "E" : "W").charCodeAt(0);
              gpsBuf[35] = 0;
              // 0x0004 Lon
              gv.setUint16(38, 0x0004, le);
              gv.setUint16(40, 5, le);
              gv.setUint32(42, 3, le);
              gv.setUint32(46, lonHeapOff, le);
              gv.setUint32(50, 0, le);
              const dmsLat = decimalToDMSRationals(lat);
              for (let idx = 0; idx < dmsLat.length; idx++) {
                const [n, d] = dmsLat[idx];
                gv.setUint32(54 + idx * 8, n, le);
                gv.setUint32(54 + idx * 8 + 4, d, le);
              }
              const dmsLon = decimalToDMSRationals(lon);
              for (let idx = 0; idx < dmsLon.length; idx++) {
                const [n, d] = dmsLon[idx];
                gv.setUint32(78 + idx * 8, n, le);
                gv.setUint32(78 + idx * 8 + 4, d, le);
              }
              const gpsPtr12 = new Uint8Array(12);
              const pv = new DataView(gpsPtr12.buffer);
              pv.setUint16(0, 0x8825, le);
              pv.setUint16(2, 4, le);
              pv.setUint32(4, 1, le);
              pv.setUint32(8, appendedTailOffset, le);
              appendedChunks.push(gpsBuf);
              appendedTailOffset += gpsIfdSize;
              entries = entries.filter((e) => e.tagId !== 0x8825);
              entries.push({ tagId: 0x8825, raw12: gpsPtr12 });
            }
          }
        }

        entries.sort((a, b) => a.tagId - b.tagId);
        const rawDirLen = 2 + entries.length * 12 + 4;
        const newIfdSize = rawDirLen + (rawDirLen % 2);
        const newIfdBuf = new Uint8Array(newIfdSize);
        const nv = new DataView(newIfdBuf.buffer);
        nv.setUint16(0, entries.length, le);
        for (let idx = 0; idx < entries.length; idx++) {
          newIfdBuf.set(entries[idx].raw12, 2 + idx * 12);
        }
        nv.setUint32(2 + entries.length * 12, nextIfdPtr, le);
        cleanView.setUint32(4, appendedTailOffset, le);
        appendedChunks.push(newIfdBuf);
        appendedTailOffset += newIfdSize;
      }
    }
  }

  const dims =
    parsed.width && parsed.height
      ? `${parsed.width} × ${parsed.height}`
      : format;
  const tailStart = Math.min(uint8.length, Math.max(8, uint8.length - 65536));
  const sensorCrc = crc32(cleanedUint8.subarray(tailStart, uint8.length));
  const finalBytes =
    appendedChunks.length > 0
      ? concatUint8Arrays([cleanedUint8, ...appendedChunks])
      : cleanedUint8;

  return packResult(
    format,
    extMatch,
    mime,
    dims,
    uint8,
    finalBytes,
    parsed.tags,
    sensorCrc,
    {
      gps: parsed.gps,
      orientation: parsed.orientation,
      thumbnailBytes: parsed.thumbnailBytes,
    }
  );
}
