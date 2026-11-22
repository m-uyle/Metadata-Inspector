import { crc32, latin1Decoder } from "../binary.js";
import { scrubGIF } from "./formats/gif.js";
import { scrubISOBMFF } from "./formats/isobmff.js";
import { scrubJPEG } from "./formats/jpeg.js";
import { scrubPNG } from "./formats/png.js";
import { scrubRAF } from "./formats/raf.js";
import { scrubTIFFAndRAW } from "./formats/tiff-raw.js";
import { scrubWebP } from "./formats/webp.js";
import { computeRemaining, independentScan } from "./verify.js";

function processImageLosslessCore(
  arrayBuffer,
  fileName = "",
  options = {
    keepICC: false,
    keepOrientation: true,
    customTagsToInject: null,
  }
) {
  const uint8 = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  // 1. JPEG (.jpg, .jpeg, .jpe, .jfif)
  if (uint8.length >= 2 && uint8[0] === 0xff && uint8[1] === 0xd8) {
    return scrubJPEG(uint8, view, options);
  }

  // 2. PNG / APNG (.png, .apng)
  if (
    uint8.length >= 8 &&
    uint8[0] === 0x89 &&
    uint8[1] === 0x50 &&
    uint8[2] === 0x4e &&
    uint8[3] === 0x47 &&
    uint8[4] === 0x0d &&
    uint8[5] === 0x0a &&
    uint8[6] === 0x1a &&
    uint8[7] === 0x0a
  ) {
    return scrubPNG(uint8, view, options);
  }

  // 3. WebP (.webp)
  if (
    uint8.length >= 12 &&
    uint8[0] === 0x52 &&
    uint8[1] === 0x49 &&
    uint8[2] === 0x46 &&
    uint8[3] === 0x46 &&
    uint8[8] === 0x57 &&
    uint8[9] === 0x45 &&
    uint8[10] === 0x42 &&
    uint8[11] === 0x50
  ) {
    return scrubWebP(uint8, view, options);
  }

  // 4. GIF (.gif)
  if (
    uint8.length >= 6 &&
    uint8[0] === 0x47 &&
    uint8[1] === 0x49 &&
    uint8[2] === 0x46 &&
    uint8[3] === 0x38 &&
    (uint8[4] === 0x37 || uint8[4] === 0x39) &&
    uint8[5] === 0x61
  ) {
    return scrubGIF(uint8, view, options);
  }

  // 5. Fujifilm RAF RAW (.raf)
  if (
    uint8.length >= 92 &&
    latin1Decoder.decode(uint8.subarray(0, 15)) === "FUJIFILMCCD-RAW"
  ) {
    return scrubRAF(uint8, view, options);
  }

  // 6. TIFF & Camera RAW / DNG
  if (
    uint8.length >= 8 &&
    ((uint8[0] === 0x49 && uint8[1] === 0x49) ||
      (uint8[0] === 0x4d && uint8[1] === 0x4d))
  ) {
    const le = uint8[0] === 0x49;
    const magic = view.getUint16(2, le);
    if (
      magic === 42 ||
      magic === 0x4f52 ||
      magic === 0x5352 ||
      magic === 0x0055
    ) {
      return scrubTIFFAndRAW(uint8, view, fileName, options);
    }
  }

  // 7. ISOBMFF Family: HEIC, HEIF, AVIF, Canon CR3
  if (uint8.length >= 12) {
    const boxType = latin1Decoder.decode(uint8.subarray(4, 8));
    if (boxType === "ftyp") {
      return scrubISOBMFF(uint8, view, fileName, options);
    }
  }

  throw new Error("Unsupported file format");
}

export function processImageLossless(arrayBuffer, fileName, options) {
  try {
    return processImageLosslessCore(arrayBuffer, fileName, options);
  } catch (e) {
    if (e instanceof RangeError || e instanceof TypeError) {
      throw new Error("Damaged or unsupported file structure");
    }
    throw e;
  }
}

export function runEngineTask(buffer, name, options = {}) {
  const result = processImageLossless(buffer, name, options);
  if (options?.verifyWith) {
    const { outName, keptTags, scanTags } = options.verifyWith;
    try {
      const vr = processImageLossless(
        result.cleanedBytes.buffer.slice(0),
        outName,
        { keepICC: true, keepOrientation: true }
      );
      const verify = computeRemaining(vr, keptTags);
      for (const h of independentScan(result.cleanedBytes, scanTags)) {
        if (!verify.remaining.some((r) => r.id === h.id)) {
          verify.remaining.push({
            id: h.id,
            label: `${h.label} (found by byte scan)`,
          });
        }
      }
      verify.count = verify.remaining.length;
      result.verify = verify;
    } catch {
      result.verify = { failed: true, remaining: [], count: 0 };
    }
    result.cleanCrc = crc32(result.cleanedBytes);
  }
  if (options?.inspectOnly) {
    result.cleanedBytes = null;
  }
  return result;
}
