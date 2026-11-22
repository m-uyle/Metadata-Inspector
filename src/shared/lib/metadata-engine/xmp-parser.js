import { sanitizeString, utf8Decoder } from "../binary.js";

const XMP_PATTERNS = [
  [
    /xmp:CreatorTool=["'>]([^"'<]+)/i,
    "XMP:Tool",
    "Creator Tool",
    "Software",
    true,
  ],
  [
    /photoshop:AuthorsPosition=["'>]([^"'<]+)/i,
    "XMP:Author",
    "Author Position",
    "Identity",
    true,
  ],
  [
    /crs:RawFileName=["'>]([^"'<]+)/i,
    "XMP:RawFile",
    "Original RAW Filename",
    "Environment",
    true,
  ],
  [
    /aux:SerialNumber=["'>]([^"'<]+)/i,
    "XMP:Serial",
    "Serial Number",
    "Hardware",
    true,
  ],
  [/aux:Lens=["'>]([^"'<]+)/i, "XMP:Lens", "Lens Profile", "Optics", false],
];

export function extractXmpAttributes(xmpBytes) {
  const extracted = [];
  try {
    const xmlStr = utf8Decoder.decode(xmpBytes);
    for (const [re, id, label, category, privacy] of XMP_PATTERNS) {
      const m = xmlStr.match(re);
      if (m?.[1]) {
        extracted.push({
          id,
          label,
          category,
          value: sanitizeString(m[1]),
          privacy,
        });
      }
    }
  } catch {
    // Malformed XMP packet is safely ignored
  }
  return extracted;
}
