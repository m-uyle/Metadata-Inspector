import {
  concatUint8Arrays,
  crc32,
  crc32Final,
  crc32Update,
  decodeSmartText,
  latin1Decoder,
  packResult,
  sanitizeString,
  textEncoder,
  utf8Decoder,
} from "../../binary.js";
import { buildCustomTiffPayload, parseExifBuffer } from "../tiff-codec.js";
import { extractXmpAttributes } from "../xmp-parser.js";

export function buildPngExifChunk(
  tagsList,
  defaultOrient = 1,
  thumbnailBytesToKeep = null
) {
  const tiffBytes = buildCustomTiffPayload(
    tagsList,
    defaultOrient,
    thumbnailBytesToKeep
  );
  const chunk = new Uint8Array(12 + tiffBytes.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, tiffBytes.length, false);
  chunk.set([0x65, 0x58, 0x49, 0x66], 4);
  chunk.set(tiffBytes, 8);
  view.setUint32(
    8 + tiffBytes.length,
    crc32(chunk.subarray(4, 8 + tiffBytes.length)),
    false
  );
  return chunk;
}

export function buildPngTextChunk(keyword, text) {
  const rawKey = sanitizeString(keyword || "Comment").slice(0, 78) || "Comment";
  const rawVal = sanitizeString(text || "");
  let isLatin1 = true;
  for (let i = 0; i < rawKey.length; i++) {
    if (rawKey.charCodeAt(i) > 0x7e || rawKey.charCodeAt(i) < 0x20) {
      isLatin1 = false;
      break;
    }
  }
  if (isLatin1) {
    for (let i = 0; i < rawVal.length; i++) {
      if (rawVal.charCodeAt(i) > 0xff) {
        isLatin1 = false;
        break;
      }
    }
  }
  if (isLatin1) {
    const keyBytes = new Uint8Array(rawKey.length);
    for (let i = 0; i < rawKey.length; i++) keyBytes[i] = rawKey.charCodeAt(i);
    const valBytes = new Uint8Array(rawVal.length);
    for (let i = 0; i < rawVal.length; i++) {
      valBytes[i] = rawVal.charCodeAt(i) & 0xff;
    }
    const dataLen = keyBytes.length + 1 + valBytes.length;
    const chunk = new Uint8Array(12 + dataLen);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, dataLen, false);
    chunk.set([0x74, 0x45, 0x58, 0x74], 4); // tEXt
    chunk.set(keyBytes, 8);
    chunk[8 + keyBytes.length] = 0;
    chunk.set(valBytes, 8 + keyBytes.length + 1);
    view.setUint32(8 + dataLen, crc32(chunk.subarray(4, 8 + dataLen)), false);
    return chunk;
  }

  const keyBytes = textEncoder.encode(rawKey);
  const valBytes = textEncoder.encode(rawVal);
  const dataLen = keyBytes.length + 5 + valBytes.length;
  const chunk = new Uint8Array(12 + dataLen);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, dataLen, false);
  chunk.set([0x69, 0x54, 0x58, 0x74], 4); // iTXt
  chunk.set(keyBytes, 8);
  chunk.set(valBytes, 8 + keyBytes.length + 5);
  view.setUint32(8 + dataLen, crc32(chunk.subarray(4, 8 + dataLen)), false);
  return chunk;
}

export function decodePngTextPayload(typeName, sliceBytes) {
  if (typeName === "tEXt") {
    const nul = sliceBytes.indexOf(0);
    if (nul === -1) return sanitizeString(decodeSmartText(sliceBytes));
    const key =
      sanitizeString(latin1Decoder.decode(sliceBytes.subarray(0, nul))) ||
      "Comment";
    const val = sanitizeString(decodeSmartText(sliceBytes.subarray(nul + 1)));
    return `${key}: ${val}`;
  }
  if (typeName === "iTXt") {
    const nul1 = sliceBytes.indexOf(0);
    if (nul1 === -1) return sanitizeString(utf8Decoder.decode(sliceBytes));
    const key =
      sanitizeString(utf8Decoder.decode(sliceBytes.subarray(0, nul1))) ||
      "Comment";
    const compFlag = sliceBytes[nul1 + 1] || 0;
    let p = nul1 + 3;
    const nul2 = sliceBytes.indexOf(0, p);
    if (nul2 !== -1) p = nul2 + 1;
    const nul3 = sliceBytes.indexOf(0, p);
    if (nul3 !== -1) p = nul3 + 1;
    if (compFlag === 0 && p <= sliceBytes.length) {
      const val = sanitizeString(utf8Decoder.decode(sliceBytes.subarray(p)));
      return `${key}: ${val}`;
    }
    return `${key}: <Compressed iTXt ${sliceBytes.length} B>`;
  }
  if (typeName === "zTXt") {
    const nul = sliceBytes.indexOf(0);
    const key =
      nul === -1
        ? "zTXt"
        : sanitizeString(latin1Decoder.decode(sliceBytes.subarray(0, nul)));
    return `${key || "zTXt"}: <Compressed zTXt ${sliceBytes.length} B>`;
  }
  return `${sliceBytes.length} B`;
}

export function scrubPNG(uint8, view, options = {}) {
  const keptChunks = [uint8.subarray(0, 8)];
  const metadataTags = [];
  let gpsInfo = null;
  let orientation = null;
  let thumbnailBytes = null;
  let dimensions = null;
  let pixelStreamCRC = 0xffffffff;
  let isApng = false;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;
  let textIdx = 0;

  const customTags = options.customTagsToInject || [];
  const keepIds = new Set(customTags.map((t) => t.id));
  const keepThumb = keepIds.has("IFD1:THUMB");

  let scanPos = 8;
  while (scanPos + 12 <= uint8.length) {
    const dLen = view.getUint32(scanPos, false);
    if (dLen > uint8.length - scanPos - 12) break;
    const tName = latin1Decoder.decode(
      uint8.subarray(scanPos + 4, scanPos + 8)
    );
    const cEnd = scanPos + 12 + dLen;
    if (tName === "eXIf") {
      const prs = parseExifBuffer(uint8, view, scanPos + 8, cEnd - 4);
      if (prs.orientation) orientation = prs.orientation;
      if (prs.thumbnailBytes) thumbnailBytes = prs.thumbnailBytes;
    }
    scanPos = cEnd;
    if (tName === "IEND") break;
  }

  const SAFE_CHUNKS = new Set([
    "CgBI",
    "IHDR",
    "PLTE",
    "IDAT",
    "IEND",
    "tRNS",
    "gAMA",
    "cHRM",
    "sRGB",
    "sBIT",
    "bKGD",
    "acTL",
    "fcTL",
    "fdAT",
  ]);
  if (options.keepICC || keepIds.has("iCCP") || keepIds.has("ICC")) {
    SAFE_CHUNKS.add("iCCP");
  }
  const editedTimeTag = customTags.find((t) => t.id === "tIME" && t.edited);
  if (keepIds.has("pHYs")) SAFE_CHUNKS.add("pHYs");
  if (keepIds.has("tIME") && !editedTimeTag) SAFE_CHUNKS.add("tIME");

  let pos = 8;
  while (pos + 12 <= uint8.length) {
    const dataLen = view.getUint32(pos, false);
    if (dataLen > uint8.length - pos - 12) {
      throw new Error("Damaged PNG: chunk exceeds file size");
    }
    const typeName = latin1Decoder.decode(uint8.subarray(pos + 4, pos + 8));
    const chunkEnd = pos + 12 + dataLen;
    const fullChunk = uint8.subarray(pos, chunkEnd);

    if (typeName === "acTL") isApng = true;
    if (typeName === "IHDR") {
      if (dataLen !== 13 || pos + 21 > uint8.length) {
        throw new Error("Damaged PNG: invalid IHDR");
      }
      const w = view.getUint32(pos + 8, false);
      const h = view.getUint32(pos + 12, false);
      if (w === 0 || h === 0) throw new Error("Damaged PNG: zero dimensions");
      sawIhdr = true;
      dimensions = `${w} × ${h}`;
    }

    let isKept = SAFE_CHUNKS.has(typeName);
    if (typeName === "IDAT" || typeName === "fdAT") {
      if (!sawIhdr) throw new Error("Damaged PNG: IDAT before IHDR");
      sawIdat = true;
      pixelStreamCRC = crc32Update(
        uint8.subarray(pos + 8, pos + 8 + dataLen),
        pixelStreamCRC
      );
    } else if (typeName === "iCCP") {
      const nul = uint8
        .subarray(pos + 8, pos + 8 + Math.min(dataLen, 80))
        .indexOf(0);
      const profName =
        nul > 0
          ? sanitizeString(
              latin1Decoder.decode(uint8.subarray(pos + 8, pos + 8 + nul))
            )
          : "ICC";
      metadataTags.push({
        id: "iCCP",
        label: `ICC Profile (${profName})`,
        category: "Profile",
        privacy: false,
        value: `${dataLen} B`,
      });
    } else if (typeName === "eXIf") {
      const parsed = parseExifBuffer(uint8, view, pos + 8, chunkEnd - 4);
      metadataTags.push(...parsed.tags);
      if (parsed.gps) gpsInfo = parsed.gps;
      if (parsed.orientation) orientation = parsed.orientation;
      if (parsed.thumbnailBytes) thumbnailBytes = parsed.thumbnailBytes;
    } else if (
      typeName === "tEXt" ||
      typeName === "iTXt" ||
      typeName === "zTXt"
    ) {
      const sliceBytes = uint8.subarray(pos + 8, pos + 8 + dataLen);
      metadataTags.push(...extractXmpAttributes(sliceBytes));
      const rawText = decodePngTextPayload(typeName, sliceBytes);
      const tid = textIdx === 0 ? typeName : `${typeName}:${textIdx}`;
      textIdx++;
      metadataTags.push({
        rawChunk: fullChunk.slice(),
        id: tid,
        label: `Text Block (${typeName})`,
        category: "Description",
        privacy: true,
        value: rawText || `${dataLen} B`,
      });
    } else if (typeName === "tIME") {
      let timeVal = `${dataLen} B`;
      if (dataLen === 7) {
        const yr = view.getUint16(pos + 8, false);
        const mo = String(uint8[pos + 10]).padStart(2, "0");
        const da = String(uint8[pos + 11]).padStart(2, "0");
        const hr = String(uint8[pos + 12]).padStart(2, "0");
        const mi = String(uint8[pos + 13]).padStart(2, "0");
        const se = String(uint8[pos + 14]).padStart(2, "0");
        timeVal = `${yr}:${mo}:${da} ${hr}:${mi}:${se}`;
      }
      metadataTags.push({
        id: "tIME",
        label: "Modify Timestamp (tIME)",
        category: "Timestamp",
        privacy: true,
        value: timeVal,
      });
    } else if (typeName === "pHYs") {
      metadataTags.push({
        id: "pHYs",
        label: "DPI Fingerprint (pHYs)",
        category: "Hardware",
        privacy: true,
        value: `${dataLen} B`,
      });
    } else if (!isKept) {
      metadataTags.push({
        id: typeName,
        label: `Chunk ${typeName}`,
        category: "Metadata",
        privacy: true,
        value: `${dataLen} B`,
      });
      if (keepIds.has(typeName)) isKept = true;
    }

    if (isKept) {
      keptChunks.push(fullChunk);
      if (
        typeName === "IHDR" &&
        (customTags.length > 0 || (keepThumb && thumbnailBytes))
      ) {
        const isTextTag = (t) =>
          ["tEXt", "iTXt", "zTXt", "COM"].includes(t.id) ||
          /^(tEXt|iTXt|zTXt|COM):/.test(t.id);
        const exifCompatible = customTags.filter(
          (t) =>
            !(
              isTextTag(t) ||
              [
                "tIME",
                "pHYs",
                "iCCP",
                "ICC",
                "ICCP",
                "XMP",
                "IPTC",
                "IFD1:THUMB",
              ].includes(t.id)
            )
        );
        if (
          exifCompatible.length > 0 ||
          (keepThumb && thumbnailBytes) ||
          (options.keepOrientation && orientation > 1)
        ) {
          keptChunks.push(
            buildPngExifChunk(
              exifCompatible,
              orientation || 1,
              keepThumb ? thumbnailBytes : null
            )
          );
        }
        for (const tt of customTags.filter(isTextTag)) {
          if (tt.rawChunk && !tt.edited) {
            keptChunks.push(tt.rawChunk);
          } else {
            const str = String(tt.value);
            const sepIdx = str.indexOf(": ");
            const kw =
              sepIdx === -1
                ? tt.label && !tt.label.startsWith("Text Block")
                  ? tt.label
                  : "Comment"
                : str.slice(0, sepIdx);
            const body = sepIdx === -1 ? str : str.slice(sepIdx + 2);
            keptChunks.push(buildPngTextChunk(kw, body));
          }
        }
        if (editedTimeTag) {
          const tm = String(editedTimeTag.value).match(
            /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
          );
          if (tm) {
            const tChunk = new Uint8Array(19);
            const tv = new DataView(tChunk.buffer);
            tv.setUint32(0, 7, false);
            tChunk.set([0x74, 0x49, 0x4d, 0x45], 4);
            tv.setUint16(8, Number(tm[1]), false);
            tChunk[10] = Number(tm[2]);
            tChunk[11] = Number(tm[3]);
            tChunk[12] = Number(tm[4]);
            tChunk[13] = Number(tm[5]);
            tChunk[14] = Number(tm[6]);
            tv.setUint32(15, crc32(tChunk.subarray(4, 15)), false);
            keptChunks.push(tChunk);
          }
        }
      }
    }
    pos = chunkEnd;
    if (typeName === "IEND") {
      sawIend = true;
      break;
    }
  }

  if (!(sawIhdr && sawIdat && sawIend)) {
    throw new Error("Damaged PNG: missing critical IHDR, IDAT, or IEND chunk");
  }
  if (
    customTags.length === 0 &&
    !(keepThumb && thumbnailBytes) &&
    options.keepOrientation &&
    orientation > 1 &&
    keptChunks.length > 1
  ) {
    const last = keptChunks.at(-1);
    if (
      last.length === 12 &&
      latin1Decoder.decode(last.subarray(4, 8)) === "IEND"
    ) {
      keptChunks.splice(
        keptChunks.length - 1,
        0,
        buildPngExifChunk([], orientation, null)
      );
    }
  }
  return packResult(
    isApng ? "APNG" : "PNG",
    ".png",
    "image/png",
    dimensions,
    uint8,
    concatUint8Arrays(keptChunks),
    metadataTags,
    crc32Final(pixelStreamCRC),
    { gps: gpsInfo, orientation, thumbnailBytes }
  );
}
