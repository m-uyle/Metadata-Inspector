import {
  concatUint8Arrays,
  crc32Final,
  crc32Update,
  latin1Decoder,
  packResult,
} from "../../binary.js";
import { buildCustomTiffPayload, parseExifBuffer } from "../tiff-codec.js";
import { extractXmpAttributes } from "../xmp-parser.js";

export function parseSimpleWebpDimensions(fourCC, chunkData) {
  if (
    fourCC === "VP8 " &&
    chunkData.length >= 10 &&
    chunkData[3] === 0x9d &&
    chunkData[4] === 0x01 &&
    chunkData[5] === 0x2a
  ) {
    return {
      w: (chunkData[6] | (chunkData[7] << 8)) & 0x3fff,
      h: (chunkData[8] | (chunkData[9] << 8)) & 0x3fff,
    };
  }
  if (fourCC === "VP8L" && chunkData.length >= 5 && chunkData[0] === 0x2f) {
    const b1 = chunkData[1];
    const b2 = chunkData[2];
    const b3 = chunkData[3];
    const b4 = chunkData[4];
    return {
      w: 1 + (b1 | ((b2 & 0x3f) << 8)),
      h: 1 + (((b2 & 0xc0) >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
    };
  }
  return null;
}

export function buildWebpExifSubChunk(
  tagsList,
  defaultOrient = 1,
  thumbnailBytesToKeep = null
) {
  const tiffBytes = buildCustomTiffPayload(
    tagsList,
    defaultOrient,
    thumbnailBytesToKeep
  );
  const chunk = new Uint8Array(8 + tiffBytes.length + (tiffBytes.length % 2));
  chunk.set([0x45, 0x58, 0x49, 0x46], 0);
  new DataView(chunk.buffer).setUint32(4, tiffBytes.length, true);
  chunk.set(tiffBytes, 8);
  return chunk;
}

export function scrubWebP(uint8, view, options = {}) {
  const keptSubChunks = [];
  const metadataTags = [];
  let gpsInfo = null;
  let orientation = null;
  let thumbnailBytes = null;
  let dimensions = "WebP";
  let numericWidth = 0;
  let numericHeight = 0;
  let hasVp8x = false;
  let sawImageChunk = false;
  let pixelStreamCRC = 0xffffffff;

  const customTags = options.customTagsToInject || [];
  const keepIds = new Set(customTags.map((t) => t.id));
  const keepXmp = keepIds.has("XMP");
  const keepIcc = options.keepICC || keepIds.has("ICCP") || keepIds.has("ICC");
  const keepThumb = keepIds.has("IFD1:THUMB");
  const exifCustomTags = customTags.filter(
    (t) => !["XMP", "ICCP", "ICC", "iCCP", "IFD1:THUMB"].includes(t.id)
  );

  if (view.getUint32(4, true) + 8 > uint8.length) {
    throw new Error("Damaged WebP: file is truncated");
  }

  let pos = 12;
  while (pos + 8 <= uint8.length) {
    const fourCC = latin1Decoder.decode(uint8.subarray(pos, pos + 4));
    const chunkSize = view.getUint32(pos + 4, true);
    if (pos + 8 + chunkSize > uint8.length) {
      throw new Error("Damaged WebP: chunk exceeds file size");
    }
    const chunkEnd = Math.min(
      uint8.length,
      pos + 8 + chunkSize + (chunkSize % 2)
    );
    const fullChunk = uint8.subarray(pos, chunkEnd);

    const isMeta =
      ![
        "VP8X",
        "VP8 ",
        "VP8L",
        "ALPH",
        "ANIM",
        "ANMF",
        "ICCP",
        "EXIF",
        "XMP ",
      ].includes(fourCC) ||
      fourCC === "EXIF" ||
      (fourCC === "XMP " && !keepXmp) ||
      (fourCC === "ICCP" && !keepIcc);

    if (fourCC === "VP8X" && pos + 18 <= uint8.length) {
      hasVp8x = true;
      numericWidth =
        1 +
        (uint8[pos + 12] | (uint8[pos + 13] << 8) | (uint8[pos + 14] << 16));
      numericHeight =
        1 +
        (uint8[pos + 15] | (uint8[pos + 16] << 8) | (uint8[pos + 17] << 16));
      dimensions = `${numericWidth} × ${numericHeight}`;
    } else if (fourCC === "VP8 " || fourCC === "VP8L" || fourCC === "ANMF") {
      sawImageChunk = true;
      pixelStreamCRC = crc32Update(fullChunk, pixelStreamCRC);
      if (!numericWidth && (fourCC === "VP8 " || fourCC === "VP8L")) {
        const dims = parseSimpleWebpDimensions(
          fourCC,
          uint8.subarray(pos + 8, chunkEnd)
        );
        if (dims) {
          numericWidth = dims.w;
          numericHeight = dims.h;
          dimensions = `${dims.w} × ${dims.h}`;
        }
      }
    } else if (fourCC === "EXIF") {
      const tiffStart =
        latin1Decoder.decode(
          uint8.subarray(pos + 8, Math.min(chunkEnd, pos + 12))
        ) === "Exif"
          ? pos + 14
          : pos + 8;
      const parsed = parseExifBuffer(uint8, view, tiffStart, chunkEnd);
      metadataTags.push(...parsed.tags);
      if (parsed.gps) gpsInfo = parsed.gps;
      if (parsed.thumbnailBytes) thumbnailBytes = parsed.thumbnailBytes;
      if (parsed.orientation) orientation = parsed.orientation;
    } else if (fourCC === "XMP ") {
      metadataTags.push(
        ...extractXmpAttributes(uint8.subarray(pos + 8, chunkEnd))
      );
      metadataTags.push({
        id: "XMP",
        label: "XMP Payload",
        category: "Software",
        privacy: true,
        value: `${chunkSize} B`,
      });
    } else if (fourCC === "ICCP") {
      metadataTags.push({
        id: "ICCP",
        label: "ICCP Profile",
        category: "Profile",
        privacy: false,
        value: `${chunkSize} B`,
      });
    }

    if (!isMeta) {
      let chunkOut = fullChunk;
      if (fourCC === "VP8X" && fullChunk.length >= 18) {
        const vp8xCopy = fullChunk.slice();
        const clearMask = 0x08 | (keepXmp ? 0 : 0x04) | (keepIcc ? 0 : 0x20);
        vp8xCopy[8] &= ~clearMask;
        chunkOut = vp8xCopy;
      }
      if (chunkOut.length % 2 === 1) {
        const padded = new Uint8Array(chunkOut.length + 1);
        padded.set(chunkOut, 0);
        chunkOut = padded;
      }
      keptSubChunks.push(chunkOut);
    }
    pos = chunkEnd;
  }

  if (!sawImageChunk) throw new Error("Damaged WebP: no image bitstream found");

  const needExif =
    exifCustomTags.length > 0 ||
    (keepThumb && thumbnailBytes) ||
    (options.keepOrientation && orientation > 1);
  if (needExif) {
    if (hasVp8x) {
      const vp8xChunk = keptSubChunks.find(
        (c) =>
          c.length >= 18 &&
          c[0] === 0x56 &&
          c[1] === 0x50 &&
          c[2] === 0x38 &&
          c[3] === 0x58
      );
      if (vp8xChunk) vp8xChunk[8] |= 0x08;
    } else {
      const vp8x = new Uint8Array(18);
      vp8x.set([0x56, 0x50, 0x38, 0x58], 0);
      new DataView(vp8x.buffer).setUint32(4, 10, true);
      vp8x[8] = 0x08;
      const wm1 = Math.max(0, (numericWidth || 1) - 1);
      const hm1 = Math.max(0, (numericHeight || 1) - 1);
      vp8x[12] = wm1 & 0xff;
      vp8x[13] = (wm1 >> 8) & 0xff;
      vp8x[14] = (wm1 >> 16) & 0xff;
      vp8x[15] = hm1 & 0xff;
      vp8x[16] = (hm1 >> 8) & 0xff;
      vp8x[17] = (hm1 >> 16) & 0xff;
      keptSubChunks.unshift(vp8x);
    }
    keptSubChunks.push(
      buildWebpExifSubChunk(
        exifCustomTags,
        orientation || 1,
        keepThumb ? thumbnailBytes : null
      )
    );
  }

  const bodyUint8 = concatUint8Arrays(keptSubChunks);
  const cleanedUint8 = new Uint8Array(12 + bodyUint8.length);
  cleanedUint8.set(uint8.subarray(0, 12), 0);
  new DataView(cleanedUint8.buffer).setUint32(4, 4 + bodyUint8.length, true);
  cleanedUint8.set(bodyUint8, 12);

  return packResult(
    "WEBP",
    ".webp",
    "image/webp",
    dimensions,
    uint8,
    cleanedUint8,
    metadataTags,
    crc32Final(pixelStreamCRC),
    { gps: gpsInfo, orientation, thumbnailBytes }
  );
}
