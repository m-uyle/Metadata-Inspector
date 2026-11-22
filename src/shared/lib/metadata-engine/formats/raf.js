import { crc32, packResult } from "../../binary.js";
import { scrubJPEG } from "./jpeg.js";

export function scrubRAF(uint8, view, options = {}) {
  const jpegOffset = view.getUint32(84, false);
  const jpegLen = view.getUint32(88, false);
  const cfaOffset = view.getUint32(92, false);
  const cfaLen = view.getUint32(96, false);
  const cleanedUint8 = uint8.slice();
  let metadataTags = [];
  let gps = null;
  let orientation = null;
  let thumbnailBytes = null;
  let dimensions = "RAF RAW";

  if (jpegOffset > 0 && jpegOffset + jpegLen <= uint8.length) {
    const jpegSlice = uint8.slice(jpegOffset, jpegOffset + jpegLen);
    const jpegRes = scrubJPEG(
      jpegSlice,
      new DataView(jpegSlice.buffer),
      options
    );
    metadataTags = jpegRes.metadataTags;
    gps = jpegRes.gps;
    orientation = jpegRes.orientation;
    thumbnailBytes = jpegRes.thumbnailBytes;
    dimensions = jpegRes.dimensions === "—" ? dimensions : jpegRes.dimensions;
    if (jpegRes.cleanedBytes.length <= jpegLen) {
      cleanedUint8.fill(0, jpegOffset, jpegOffset + jpegLen);
      cleanedUint8.set(jpegRes.cleanedBytes, jpegOffset);
    }
  }

  const cfaSlice =
    cfaOffset > 0 && cfaOffset + cfaLen <= uint8.length
      ? uint8.subarray(cfaOffset, cfaOffset + Math.min(cfaLen, 65536))
      : uint8.subarray(0, 84);

  return packResult(
    "RAF",
    ".raf",
    "image/x-fuji-raf",
    dimensions,
    uint8,
    cleanedUint8,
    metadataTags,
    crc32(cfaSlice),
    { gps, orientation, thumbnailBytes }
  );
}
