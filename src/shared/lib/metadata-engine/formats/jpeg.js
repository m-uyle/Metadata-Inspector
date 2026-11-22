import {
  concatUint8Arrays,
  crc32Final,
  crc32Update,
  decodeSmartText,
  latin1Decoder,
  packResult,
  sanitizeString,
  textEncoder,
} from "../../binary.js";
import { buildCustomExifApp1, parseExifBuffer } from "../tiff-codec.js";
import { extractXmpAttributes } from "../xmp-parser.js";

const JPEG_MAX_COM_BYTES = 65533;

export function scrubJPEG(uint8, view, options = {}) {
  let sawSof = false;
  let sawEoi = false;
  const keptChunks = [];
  const metadataTags = [];
  let gpsInfo = null;
  let orientation = null;
  let thumbnailBytes = null;
  let dimensions = null;
  let pixelStreamCRC = 0xffffffff;

  const customTags = options.customTagsToInject || [];
  const keepIds = new Set(customTags.map((t) => t.id));
  const keepXmp = keepIds.has("XMP");
  const keepIptc = keepIds.has("IPTC");
  const keepIcc = options.keepICC || keepIds.has("ICC");
  const keepThumb = keepIds.has("IFD1:THUMB");
  const keepJfifThumb = keepIds.has("JFIF:THUMB");
  const keepApp0 = keepIds.has("APP0");
  const comTagsToKeep = customTags.filter(
    (t) => t.id === "COM" || t.id.startsWith("COM:")
  );
  const exifCustomTags = customTags.filter(
    (t) =>
      !(
        [
          "COM",
          "XMP",
          "IPTC",
          "ICC",
          "ICCP",
          "iCCP",
          "IFD1:THUMB",
          "JFIF:THUMB",
          "APP0",
        ].includes(t.id) || t.id.startsWith("COM:")
      )
  );

  let tempPos = 2;
  const totalLen = uint8.length;
  let parsedFirstPassOrientation = null;
  while (tempPos < totalLen) {
    if (uint8[tempPos] !== 0xff) break;
    while (tempPos < totalLen && uint8[tempPos] === 0xff) tempPos++;
    if (tempPos >= totalLen) break;
    const m = uint8[tempPos++];
    if (m === 0xd9 || m === 0xda) break;
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) continue;
    if (tempPos + 2 > totalLen) break;
    const sLen = view.getUint16(tempPos, false);
    if (sLen < 2 || tempPos + sLen > totalLen) break;
    const sEnd = tempPos + sLen;
    if (
      m === 0xe1 &&
      latin1Decoder
        .decode(uint8.subarray(tempPos + 2, Math.min(sEnd, tempPos + 8)))
        .startsWith("Exif")
    ) {
      const prs = parseExifBuffer(uint8, view, tempPos + 8, sEnd);
      metadataTags.push(...prs.tags);
      if (prs.gps) gpsInfo = prs.gps;
      if (prs.orientation && prs.orientation >= 1) {
        parsedFirstPassOrientation = prs.orientation;
      }
      if (prs.thumbnailBytes) thumbnailBytes = prs.thumbnailBytes;
    }
    tempPos = sEnd;
  }

  keptChunks.push(uint8.subarray(0, 2));
  if (exifCustomTags.length > 0 || (keepThumb && thumbnailBytes)) {
    keptChunks.push(
      buildCustomExifApp1(
        exifCustomTags,
        parsedFirstPassOrientation || 1,
        keepThumb ? thumbnailBytes : null
      )
    );
    orientation = parsedFirstPassOrientation || 1;
  } else if (
    options.keepOrientation &&
    parsedFirstPassOrientation &&
    parsedFirstPassOrientation > 1
  ) {
    keptChunks.push(buildCustomExifApp1([], parsedFirstPassOrientation, null));
    orientation = parsedFirstPassOrientation;
  }

  let pos = 2;
  let comIndex = 0;
  while (pos < totalLen) {
    if (uint8[pos] !== 0xff) {
      const nextFF = uint8.indexOf(0xff, pos);
      if (nextFF === -1) break;
      pos = nextFF;
    }
    const markerOffset = pos;
    while (pos < totalLen && uint8[pos] === 0xff) pos++;
    if (pos >= totalLen) break;
    const marker = uint8[pos++];

    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      sawSof = true;
    }
    if (marker === 0xd9) {
      sawEoi = true;
      for (const ct of comTagsToKeep) {
        let comBytes = textEncoder.encode(sanitizeString(ct.value));
        if (comBytes.length > JPEG_MAX_COM_BYTES) {
          comBytes = comBytes.subarray(0, JPEG_MAX_COM_BYTES);
        }
        const comSeg = new Uint8Array(4 + comBytes.length);
        const cView = new DataView(comSeg.buffer);
        cView.setUint16(0, 0xfffe, false);
        cView.setUint16(2, 2 + comBytes.length, false);
        comSeg.set(comBytes, 4);
        keptChunks.push(comSeg);
      }
      keptChunks.push(uint8.subarray(markerOffset, pos));
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      keptChunks.push(uint8.subarray(markerOffset, pos));
      continue;
    }
    if (pos + 2 > totalLen) break;
    const segLength = view.getUint16(pos, false);
    if (segLength < 2 || pos + segLength > totalLen) break;
    const segEnd = Math.min(totalLen, pos + segLength);

    if (marker === 0xda) {
      if (!sawSof) {
        throw new Error("Damaged JPEG: scan data before frame header");
      }
      let scanPos = segEnd;
      while (scanPos < totalLen) {
        if (uint8[scanPos] === 0xff) {
          if (scanPos + 1 >= totalLen) {
            scanPos++;
            break;
          }
          const nb = uint8[scanPos + 1];
          if (nb === 0x00 || (nb >= 0xd0 && nb <= 0xd7) || nb === 0xff) {
            scanPos += nb === 0xff ? 1 : 2;
            continue;
          }
          break;
        }
        scanPos++;
      }
      const fullScanChunk = uint8.subarray(markerOffset, scanPos);
      keptChunks.push(fullScanChunk);
      pixelStreamCRC = crc32Update(fullScanChunk, pixelStreamCRC);
      pos = scanPos;
      continue;
    }

    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc &&
      pos + 7 <= totalLen
    ) {
      dimensions = `${view.getUint16(pos + 5, false)} × ${view.getUint16(pos + 3, false)}`;
    }

    let isMetadata = false;
    if (marker === 0xe1) {
      const headerStr = latin1Decoder.decode(
        uint8.subarray(pos + 2, Math.min(segEnd, pos + 32))
      );
      if (headerStr.startsWith("Exif")) isMetadata = true;
      else if (headerStr.includes("http://ns.adobe.com/xap")) {
        isMetadata = !keepXmp;
        metadataTags.push(
          ...extractXmpAttributes(uint8.subarray(pos + 2, segEnd))
        );
        metadataTags.push({
          id: "XMP",
          label: "Adobe XMP Packet",
          category: "Software",
          privacy: true,
          value: `${segLength} B`,
        });
      } else {
        isMetadata = true;
      }
    } else if (marker === 0xe2) {
      if (
        latin1Decoder
          .decode(uint8.subarray(pos + 2, Math.min(segEnd, pos + 14)))
          .startsWith("ICC_PROFILE")
      ) {
        isMetadata = !keepIcc;
        if (!metadataTags.some((t) => t.id === "ICC")) {
          metadataTags.push({
            id: "ICC",
            label: "ICC Profile",
            category: "Profile",
            privacy: false,
            value: `${segLength} B`,
          });
        }
      } else {
        isMetadata = true;
      }
    } else if (marker === 0xed) {
      isMetadata = !keepIptc;
      metadataTags.push({
        id: "IPTC",
        label: "IPTC Record",
        category: "Identity",
        privacy: true,
        value: `${segLength} B`,
      });
    } else if (marker >= 0xe3 && marker <= 0xef) {
      isMetadata = !(
        marker === 0xee &&
        latin1Decoder.decode(
          uint8.subarray(pos + 2, Math.min(segEnd, pos + 7))
        ) === "Adobe"
      );
    } else if (marker === 0xfe) {
      isMetadata = true;
      const commentTxt = sanitizeString(
        decodeSmartText(uint8.subarray(pos + 2, segEnd))
      );
      const cid = comIndex === 0 ? "COM" : `COM:${comIndex}`;
      comIndex++;
      metadataTags.push({
        id: cid,
        label: "Comment",
        category: "Description",
        privacy: true,
        value: commentTxt || `${segLength} B`,
      });
    }

    let rewrittenSegment = null;
    if (marker === 0xe0) {
      const app0Id = latin1Decoder.decode(
        uint8.subarray(pos + 2, Math.min(segEnd, pos + 7))
      );
      if (app0Id === "JFIF\0") {
        if (segEnd - pos - 2 > 14 && (uint8[pos + 14] || uint8[pos + 15])) {
          metadataTags.push({
            id: "JFIF:THUMB",
            label: "JFIF embedded thumbnail",
            category: "Preview",
            privacy: true,
            value: `${segEnd - pos - 16} B`,
          });
          if (!keepJfifThumb) {
            rewrittenSegment = new Uint8Array(18);
            rewrittenSegment.set([0xff, 0xe0, 0x00, 0x10]);
            rewrittenSegment.set(uint8.subarray(pos + 2, pos + 16), 4);
            rewrittenSegment[16] = 0;
            rewrittenSegment[17] = 0;
          }
        }
      } else {
        isMetadata = !keepApp0;
        metadataTags.push({
          id: "APP0",
          label: `APP0 segment (${sanitizeString(app0Id) || "unknown"})`,
          category: "Preview",
          privacy: true,
          value: `${segEnd - pos} B`,
        });
      }
    }

    const fullSegment =
      rewrittenSegment || uint8.subarray(markerOffset, segEnd);
    if (!isMetadata) {
      keptChunks.push(fullSegment);
      if (marker === 0xdb || marker === 0xc4) {
        pixelStreamCRC = crc32Update(fullSegment, pixelStreamCRC);
      }
    }
    pos = segEnd;
  }

  if (!sawEoi) throw new Error("Damaged JPEG: no end-of-image marker");
  return packResult(
    "JPEG",
    ".jpg",
    "image/jpeg",
    dimensions,
    uint8,
    concatUint8Arrays(keptChunks),
    metadataTags,
    crc32Final(pixelStreamCRC),
    { gps: gpsInfo, orientation, thumbnailBytes, hasExifSlot: true }
  );
}
