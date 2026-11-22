export const latin1Decoder = new TextDecoder("latin1");
export const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
export const utf8StrictDecoder = new TextDecoder("utf-8", { fatal: true });
export const utf16leDecoder = new TextDecoder("utf-16le", { fatal: false });
export const utf16beDecoder = new TextDecoder("utf-16be", { fatal: false });
export const textEncoder = new TextEncoder();

export function decodeSmartText(u8) {
  if (!u8 || u8.length === 0) return "";
  try {
    return utf8StrictDecoder.decode(u8);
  } catch {
    return latin1Decoder.decode(u8);
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * Updates a running (unfinalized) CRC32 accumulator initialized to 0xFFFFFFFF.
 */
export function crc32Update(u8, state = 0xffffffff) {
  let crc = state >>> 0;
  for (let i = 0; i < u8.length; i++) {
    crc = CRC_TABLE[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

/**
 * Finalizes a running CRC32 accumulator.
 */
export function crc32Final(state) {
  return ((state >>> 0) ^ 0xffffffff) >>> 0;
}

/**
 * Computes the standard IEEE 802.3 CRC32 checksum of a single Uint8Array.
 */
export function crc32(u8) {
  return crc32Final(crc32Update(u8, 0xffffffff));
}

export function formatHash(crcVal) {
  return `0x${(crcVal >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

export function generateCsprngToken() {
  const rnd = new Uint8Array(6);
  globalThis.crypto.getRandomValues(rnd);
  return Array.from(rnd, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const sign = bytes < 0 ? "-" : "";
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${sign}${abs} B`;
  if (abs < 1048576) return `${sign}${(abs / 1024).toFixed(1)} KB`;
  return `${sign}${(abs / 1048576).toFixed(2)} MB`;
}

const CONTROL_CHARS_RE = /[\x00-\x1f\x7f-\x9f]/g;

export function sanitizeString(str) {
  return typeof str === "string"
    ? str.replace(CONTROL_CHARS_RE, "").trim()
    : String(str);
}

export function concatUint8Arrays(arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const res = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    res.set(a, off);
    off += a.length;
  }
  return res;
}

export function packResult(
  format,
  ext,
  mime,
  dimensions,
  uint8,
  cleanedBytes,
  metadataTags,
  pixelStreamCRC,
  extra = {}
) {
  return {
    format,
    ext,
    mime,
    dimensions: dimensions || "—",
    originalSize: uint8.length,
    cleanedSize: cleanedBytes.length,
    cleanedBytes,
    metadataTags,
    gps: extra.gps || null,
    orientation: extra.orientation || null,
    thumbnailBytes: extra.thumbnailBytes || null,
    hasExifSlot: extra.hasExifSlot === undefined ? true : extra.hasExifSlot,
    pixelHash:
      typeof pixelStreamCRC === "string"
        ? pixelStreamCRC
        : formatHash(pixelStreamCRC),
  };
}
