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
import { extractXmpAttributes } from "../xmp-parser.js";

export function readGifSubBlocks(uint8, startPos) {
  const parts = [];
  let p = startPos;
  let closed = false;
  while (p < uint8.length) {
    const subLen = uint8[p++];
    if (subLen === 0) {
      closed = true;
      break;
    }
    if (p + subLen > uint8.length) break;
    parts.push(uint8.subarray(p, p + subLen));
    p += subLen;
  }
  if (!closed || p > uint8.length) {
    throw new Error("Damaged GIF: truncated block");
  }
  return { endPos: p, payload: concatUint8Arrays(parts) };
}

export function scrubGIF(uint8, view, options = {}) {
  if (uint8.length < 14) throw new Error("Damaged GIF: file too short");
  const keptChunks = [];
  const metadataTags = [];
  let pixelStreamCRC = 0xffffffff;
  let sawTrailer = false;
  let comIdx = 0;
  let appIdx = 0;

  const customTags = options.customTagsToInject || [];
  const keepIds = new Set(customTags.map((t) => t.id));
  const dimensions = `${view.getUint16(6, true)} × ${view.getUint16(8, true)}`;
  const packed = uint8[10];
  let pos = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0);
  if (pos > uint8.length) {
    throw new Error("Damaged GIF: color table exceeds file size");
  }

  keptChunks.push(uint8.subarray(0, pos));
  for (const ct of customTags) {
    if (
      ct.id === "GIF:APP" ||
      ct.id.startsWith("GIF:APP:") ||
      ct.id === "XMP"
    ) {
      continue;
    }
    const isNativeCom = ct.id === "GIF:COM" || ct.id.startsWith("GIF:COM:");
    const bytes = textEncoder.encode(
      sanitizeString(isNativeCom ? ct.value : `${ct.label}: ${ct.value}`)
    );
    const subBlocks = [new Uint8Array([0x21, 0xfe])];
    for (let p = 0; p < bytes.length; p += 255) {
      const len = Math.min(255, bytes.length - p);
      const b = new Uint8Array(1 + len);
      b[0] = len;
      b.set(bytes.subarray(p, p + len), 1);
      subBlocks.push(b);
    }
    subBlocks.push(new Uint8Array([0x00]));
    keptChunks.push(concatUint8Arrays(subBlocks));
  }

  while (pos < uint8.length) {
    const startOffset = pos;
    const introducer = uint8[pos];
    if (introducer === 0x3b) {
      sawTrailer = true;
      keptChunks.push(uint8.subarray(pos, pos + 1));
      break;
    }
    if (introducer === 0x21) {
      if (pos + 2 > uint8.length) {
        throw new Error("Damaged GIF: truncated extension");
      }
      const label = uint8[pos + 1];
      const { endPos, payload } = readGifSubBlocks(uint8, pos + 2);
      const extChunk = uint8.subarray(startOffset, endPos);
      if (label === 0xfe) {
        const commentStr = sanitizeString(decodeSmartText(payload));
        const cid = comIdx === 0 ? "GIF:COM" : `GIF:COM:${comIdx}`;
        comIdx++;
        metadataTags.push({
          id: cid,
          label: "GIF Comment",
          category: "Description",
          privacy: true,
          value: commentStr || `${extChunk.length} B`,
        });
      } else if (label === 0xff) {
        const appId = latin1Decoder.decode(
          payload.subarray(0, Math.min(payload.length, 11))
        );
        const isAnimLoop =
          appId.startsWith("NETSCAPE2.0") || appId.startsWith("ANIMEXTS1.0");
        if (appId.startsWith("XMP DataXMP")) {
          const xmpSlice = uint8.subarray(
            pos + 14,
            Math.max(pos + 14, endPos - 1)
          );
          metadataTags.push(...extractXmpAttributes(xmpSlice));
          metadataTags.push({
            id: "XMP",
            label: "GIF XMP Packet",
            category: "Software",
            privacy: true,
            value: `${extChunk.length} B`,
          });
          if (keepIds.has("XMP")) keptChunks.push(extChunk);
        } else {
          const aid = appIdx === 0 ? "GIF:APP" : `GIF:APP:${appIdx}`;
          if (!isAnimLoop) appIdx++;
          if (isAnimLoop || keepIds.has(aid) || keepIds.has("GIF:APP")) {
            keptChunks.push(extChunk);
          }
          if (!isAnimLoop) {
            metadataTags.push({
              id: aid,
              label: `Application Ext (${sanitizeString(appId) || "APP"})`,
              category: "Software",
              privacy: true,
              value: `${extChunk.length} B`,
            });
          }
        }
      } else {
        keptChunks.push(extChunk);
      }
      pos = endPos;
      continue;
    }
    if (introducer === 0x2c) {
      if (pos + 10 > uint8.length) {
        throw new Error("Damaged GIF: truncated image descriptor");
      }
      const localPacked = uint8[pos + 9];
      const lctSize =
        localPacked & 0x80 ? 3 * (1 << ((localPacked & 0x07) + 1)) : 0;
      if (pos + 10 + lctSize + 1 > uint8.length) {
        throw new Error("Damaged GIF: truncated image data");
      }
      const { endPos } = readGifSubBlocks(uint8, pos + 10 + lctSize + 1);
      const imgChunk = uint8.subarray(startOffset, endPos);
      keptChunks.push(imgChunk);
      pixelStreamCRC = crc32Update(imgChunk, pixelStreamCRC);
      pos = endPos;
      continue;
    }
    throw new Error("Damaged GIF: unexpected data between blocks");
  }

  if (!sawTrailer) throw new Error("Damaged GIF: missing trailer (0x3B)");
  return packResult(
    "GIF",
    ".gif",
    "image/gif",
    dimensions,
    uint8,
    concatUint8Arrays(keptChunks),
    metadataTags,
    crc32Final(pixelStreamCRC)
  );
}
