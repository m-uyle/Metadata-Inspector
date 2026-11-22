import { crc32, latin1Decoder, packResult } from "../../binary.js";
import {
  buildCustomTiffPayload,
  computeExactTiffSpan,
  parseExifBuffer,
} from "../tiff-codec.js";
import { extractXmpAttributes } from "../xmp-parser.js";

const XMP_START_SIG = [
  0x3c, 0x78, 0x3a, 0x78, 0x6d, 0x70, 0x6d, 0x65, 0x74, 0x61,
];
const XMP_END_SIG = [
  0x3c, 0x2f, 0x78, 0x3a, 0x78, 0x6d, 0x70, 0x6d, 0x65, 0x74, 0x61, 0x3e,
];

export function scrubISOBMFF(uint8, view, fileName, options = {}) {
  const mdatRanges = [];
  {
    let p = 0;
    while (p < uint8.length) {
      if (p + 8 > uint8.length) {
        if (uint8.subarray(p).every((x) => x === 0)) break;
        throw new Error("Damaged container: truncated box header");
      }
      let sz = view.getUint32(p, false);
      let hdrLen = 8;
      const bType = latin1Decoder.decode(uint8.subarray(p + 4, p + 8));
      if (sz === 1) {
        if (p + 16 > uint8.length) {
          throw new Error("Damaged container: truncated box header");
        }
        sz =
          view.getUint32(p + 8, false) * 4294967296 +
          view.getUint32(p + 12, false);
        hdrLen = 16;
      } else if (sz === 0) {
        sz = uint8.length - p;
      }
      if (sz < 8 || p + sz > uint8.length) {
        throw new Error("Damaged container: box size out of range");
      }
      if (bType === "mdat") mdatRanges.push([p + hdrLen, p + sz]);
      p += sz;
    }
  }

  const findMdatRange = (pos) => {
    for (const r of mdatRanges) if (pos >= r[0] && pos < r[1]) return r;
    return null;
  };

  const cleanedUint8 = uint8.slice();
  const metadataTags = [];
  let gpsInfo = null;
  let orientation = null;
  let thumbnailBytes = null;
  let dimensions = null;

  const customTags = options.customTagsToInject || [];
  const keepIds = new Set(customTags.map((t) => t.id));
  const keepXmp = keepIds.has("XMP");
  const keepThumb = keepIds.has("IFD1:THUMB");

  const ftypSize = Math.min(
    uint8.length,
    Math.max(16, view.getUint32(0, false))
  );
  const ftypBrands = latin1Decoder
    .decode(uint8.subarray(8, Math.min(ftypSize, 64)))
    .toUpperCase();
  const majorBrand = latin1Decoder
    .decode(uint8.subarray(8, 12))
    .trim()
    .toUpperCase();
  const fnLower = fileName.toLowerCase();

  let format = null;
  let ext = ".heic";
  let mime = "image/heic";
  if (majorBrand.includes("CRX") || fnLower.endsWith(".cr3")) {
    format = "CR3";
    ext = ".cr3";
    mime = "image/x-canon-cr3";
  } else if (
    majorBrand.startsWith("AVI") ||
    ftypBrands.includes("AVIF") ||
    ftypBrands.includes("AVIS") ||
    fnLower.endsWith(".avif")
  ) {
    format = "AVIF";
    ext = ".avif";
    mime = "image/avif";
  } else if (
    majorBrand.startsWith("HEI") ||
    majorBrand.startsWith("HEV") ||
    ftypBrands.includes("HEIC") ||
    ftypBrands.includes("HEIX") ||
    ftypBrands.includes("MIF1") ||
    ftypBrands.includes("MSF1") ||
    fnLower.endsWith(".heic") ||
    fnLower.endsWith(".heif") ||
    fnLower.endsWith(".hif")
  ) {
    const isHeifExt = fnLower.endsWith(".heif") || fnLower.endsWith(".hif");
    format = isHeifExt ? "HEIF" : "HEIC";
    ext = isHeifExt ? ".heif" : ".heic";
    mime = isHeifExt ? "image/heif" : "image/heic";
  }

  if (!format) {
    throw new Error(
      "Unsupported ISOBMFF container (only HEIC/HEIF, AVIF and Canon CR3 are supported)"
    );
  }

  for (let i = 0; i < Math.min(uint8.length - 20, 65536); i++) {
    if (
      uint8[i] === 0x69 &&
      uint8[i + 1] === 0x73 &&
      uint8[i + 2] === 0x70 &&
      uint8[i + 3] === 0x65
    ) {
      const w = view.getUint32(i + 8, false);
      const h = view.getUint32(i + 12, false);
      if (w > 0 && w < 65536 && h > 0 && h < 65536) {
        dimensions = `${w} × ${h}`;
        break;
      }
    }
  }

  let injectedPrimaryTiff = false;
  let foundExifSlot = false;
  for (let i = 0; i < uint8.length - 16; i++) {
    const isExifHdr =
      uint8[i] === 0x45 &&
      uint8[i + 1] === 0x78 &&
      uint8[i + 2] === 0x69 &&
      uint8[i + 3] === 0x66 &&
      uint8[i + 4] === 0x00 &&
      uint8[i + 5] === 0x00;
    const isZeroPrefixExif =
      i >= 4 &&
      view.getUint32(i - 4, false) === 0 &&
      ((uint8[i] === 0x49 &&
        uint8[i + 1] === 0x49 &&
        uint8[i + 2] === 0x2a &&
        uint8[i + 3] === 0x00 &&
        view.getUint32(i + 4, true) === 8) ||
        (uint8[i] === 0x4d &&
          uint8[i + 1] === 0x4d &&
          uint8[i + 2] === 0x00 &&
          uint8[i + 3] === 0x2a &&
          view.getUint32(i + 4, false) === 8));
    const isCr3Cmt =
      i >= 4 &&
      uint8[i - 4] === 0x43 &&
      uint8[i - 3] === 0x4d &&
      uint8[i - 2] === 0x54 &&
      uint8[i - 1] >= 0x31 &&
      uint8[i - 1] <= 0x34;
    const tiffCandidate = isExifHdr
      ? i + 6
      : isCr3Cmt || isZeroPrefixExif
        ? i
        : -1;

    if (
      tiffCandidate !== -1 &&
      tiffCandidate + 8 <= uint8.length &&
      ((uint8[tiffCandidate] === 0x49 && uint8[tiffCandidate + 1] === 0x49) ||
        (uint8[tiffCandidate] === 0x4d && uint8[tiffCandidate + 1] === 0x4d))
    ) {
      foundExifSlot = true;
      const exactSpan = computeExactTiffSpan(uint8, view, tiffCandidate);
      const safeSpan =
        exactSpan > 8 ? exactSpan : Math.min(uint8.length - tiffCandidate, 512);
      const parsed = parseExifBuffer(
        uint8,
        view,
        tiffCandidate,
        tiffCandidate + safeSpan
      );
      metadataTags.push(...parsed.tags);
      if (parsed.gps) gpsInfo = parsed.gps;
      if (parsed.orientation) orientation = parsed.orientation;
      if (parsed.thumbnailBytes) thumbnailBytes = parsed.thumbnailBytes;
      if (!dimensions && parsed.width && parsed.height) {
        dimensions = `${parsed.width} × ${parsed.height}`;
      }

      cleanedUint8.fill(0, tiffCandidate, tiffCandidate + safeSpan);
      if (safeSpan >= 14) {
        const little = uint8[tiffCandidate] === 0x49;
        cleanedUint8.set(
          little
            ? [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]
            : [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08],
          tiffCandidate
        );
      }
      if (
        (customTags.length > 0 ||
          (options.keepOrientation && orientation && orientation > 1)) &&
        !injectedPrimaryTiff
      ) {
        let newTiff = buildCustomTiffPayload(
          customTags,
          orientation || 1,
          keepThumb ? thumbnailBytes : null
        );
        if (newTiff.length > safeSpan && keepThumb && thumbnailBytes) {
          newTiff = buildCustomTiffPayload(customTags, orientation || 1, null);
        }
        if (newTiff.length > safeSpan) {
          const fitting = [];
          for (const ct of customTags) {
            const cand = buildCustomTiffPayload(
              [...fitting, ct],
              orientation || 1,
              null
            );
            if (cand.length <= safeSpan) fitting.push(ct);
          }
          if (fitting.length > 0) {
            newTiff = buildCustomTiffPayload(fitting, orientation || 1, null);
          }
        }
        if (newTiff.length <= safeSpan) {
          cleanedUint8.set(newTiff, tiffCandidate);
          injectedPrimaryTiff = true;
        }
      }
      i = tiffCandidate + safeSpan - 1;
    }
  }

  for (let i = 0; i < uint8.length - XMP_START_SIG.length; i++) {
    if (uint8[i] === 0x3c && uint8[i + 1] === 0x78 && uint8[i + 2] === 0x3a) {
      const mr = findMdatRange(i);
      if (
        mr &&
        mr[1] - mr[0] > 262144 &&
        i > mr[0] + 65536 &&
        i < mr[1] - 65536
      ) {
        i = mr[1] - 65536;
        continue;
      }
      let match = true;
      for (let k = 0; k < XMP_START_SIG.length; k++) {
        if (uint8[i + k] !== XMP_START_SIG[k]) {
          match = false;
          break;
        }
      }
      if (match) {
        let endPos = Math.min(uint8.length, i + 1048576);
        let endFound = false;
        for (
          let j = i + XMP_START_SIG.length;
          j < endPos - XMP_END_SIG.length;
          j++
        ) {
          if (
            uint8[j] === 0x3c &&
            uint8[j + 1] === 0x2f &&
            uint8[j + 2] === 0x78
          ) {
            let endMatch = true;
            for (let k = 0; k < XMP_END_SIG.length; k++) {
              if (uint8[j + k] !== XMP_END_SIG[k]) {
                endMatch = false;
                break;
              }
            }
            if (endMatch) {
              endPos = j + XMP_END_SIG.length;
              endFound = true;
              break;
            }
          }
        }
        if (endFound) {
          metadataTags.push(...extractXmpAttributes(uint8.subarray(i, endPos)));
          metadataTags.push({
            id: "XMP",
            label: "XMP Payload",
            category: "Software",
            privacy: true,
            value: `${endPos - i} B`,
          });
          if (!keepXmp) cleanedUint8.fill(0x20, i, endPos);
          i = endPos;
        }
      }
    }
  }

  let hashSlice;
  if (mdatRanges.length > 0) {
    const biggest = mdatRanges.reduce((a, b) =>
      b[1] - b[0] > a[1] - a[0] ? b : a
    );
    const span = biggest[1] - biggest[0];
    const hStart = span > 65536 ? biggest[1] - 65536 : biggest[0];
    hashSlice = cleanedUint8.subarray(hStart, biggest[1]);
  } else {
    const tailStart = Math.min(
      cleanedUint8.length,
      Math.max(16, cleanedUint8.length - 65536)
    );
    hashSlice = cleanedUint8.subarray(tailStart);
  }

  return packResult(
    format,
    ext,
    mime,
    dimensions || format,
    uint8,
    cleanedUint8,
    metadataTags,
    crc32(hashSlice),
    { gps: gpsInfo, orientation, thumbnailBytes, hasExifSlot: foundExifSlot }
  );
}
