import { sanitizeString } from "../binary.js";

let exiftoolModulePromise = null;
let exiftoolAvailable = null;

async function loadExifTool() {
  if (exiftoolAvailable === false) return null;
  if (!exiftoolModulePromise) {
    exiftoolModulePromise = import("@uswriting/exiftool")
      .then((mod) => {
        if (mod && typeof mod.parseMetadata === "function") {
          exiftoolAvailable = true;
          return mod;
        }
        exiftoolAvailable = false;
        return null;
      })
      .catch(() => {
        exiftoolAvailable = false;
        return null;
      });
  }
  return await exiftoolModulePromise;
}

export async function isExifToolAvailable() {
  const mod = await loadExifTool();
  return !!mod;
}

const SKIP_GROUPS = new Set([
  "System",
  "File",
  "ExifTool",
  "Composite",
  "SourceFile",
]);

const SKIP_TAG_NAMES = new Set([
  "SourceFile",
  "ExifToolVersion",
  "FileName",
  "Directory",
  "FileSize",
  "FileModifyDate",
  "FileAccessDate",
  "FileInodeChangeDate",
  "FilePermissions",
  "FileType",
  "FileTypeExtension",
  "MIMEType",
  "ImageWidth",
  "ImageHeight",
  "ImageSize",
  "Megapixels",
  "EncodingProcess",
  "BitsPerSample",
  "ColorComponents",
  "YCbCrSubSampling",
  "JFIFVersion",
  "ResolutionUnit",
  "XResolution",
  "YResolution",
  "Orientation",
  "ThumbnailImage",
  "PreviewImage",
]);

function mapExifToolCategory(group, tagName) {
  const g = String(group || "").toLowerCase();
  const n = String(tagName || "").toLowerCase();
  if (g.includes("gps") || n.startsWith("gps")) return "Geolocation";
  if (g.includes("icc")) return "Profile";
  if (
    g.includes("iptc") ||
    n.includes("author") ||
    n.includes("artist") ||
    n.includes("copyright") ||
    n.includes("creator") ||
    n.includes("owner")
  ) {
    return "Identity";
  }
  if (n.includes("date") || n.includes("time") || n.includes("offset")) {
    return "Timestamp";
  }
  if (
    g.includes("xmp") ||
    n.includes("software") ||
    n.includes("tool") ||
    n.includes("history")
  ) {
    return "Software";
  }
  if (
    g.includes("makernotes") ||
    n.includes("make") ||
    n.includes("model") ||
    n.includes("serial") ||
    n.includes("camera") ||
    n.includes("host")
  ) {
    return "Hardware";
  }
  if (
    n.includes("lens") ||
    n.includes("focal") ||
    n.includes("exposure") ||
    n.includes("fnumber") ||
    n.includes("iso") ||
    n.includes("aperture") ||
    n.includes("shutter")
  ) {
    return "Optics";
  }
  if (
    n.includes("comment") ||
    n.includes("description") ||
    n.includes("title") ||
    n.includes("subject") ||
    n.includes("keyword") ||
    n.includes("caption")
  ) {
    return "Description";
  }
  return "Metadata";
}

function formatTagLabel(tagName) {
  return String(tagName)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

/**
 * Extracts deep metadata (XMP, IPTC, MakerNotes, extended EXIF) via ExifTool WASM.
 * Returns null if ExifTool WASM is unavailable or fails, allowing silent fallback.
 */
export async function inspectWithExifTool(file) {
  const mod = await loadExifTool();
  if (!mod) return null;
  try {
    const res = await mod.parseMetadata(file, {
      args: ["-json", "-G1", "-s"],
      transform: (data) => JSON.parse(data),
    });
    if (!(res?.success && Array.isArray(res.data) && res.data[0])) {
      return null;
    }
    const rawObj = res.data[0];
    const tags = [];
    for (const [fullKey, rawVal] of Object.entries(rawObj)) {
      if (rawVal === null || rawVal === undefined || rawVal === "") continue;
      const colonIdx = fullKey.indexOf(":");
      const group = colonIdx === -1 ? "Metadata" : fullKey.slice(0, colonIdx);
      const tagName = colonIdx === -1 ? fullKey : fullKey.slice(colonIdx + 1);
      if (SKIP_GROUPS.has(group) || SKIP_TAG_NAMES.has(tagName)) continue;

      const value = Array.isArray(rawVal)
        ? sanitizeString(rawVal.join(", "))
        : typeof rawVal === "object"
          ? sanitizeString(JSON.stringify(rawVal))
          : sanitizeString(String(rawVal));
      if (!value) continue;

      const category = mapExifToolCategory(group, tagName);
      tags.push({
        id: `ET:${fullKey}`,
        exiftoolTag: fullKey,
        label: formatTagLabel(tagName),
        category,
        privacy: category !== "Optics" && category !== "Profile",
        value,
        source: "exiftool",
      });
    }
    return { tags };
  } catch {
    return null;
  }
}

const HEX_TO_EXIFTOOL = {
  "0x010E": "IFD0:ImageDescription",
  "0x010F": "IFD0:Make",
  "0x0110": "IFD0:Model",
  "0x0131": "IFD0:Software",
  "0x0132": "IFD0:ModifyDate",
  "0x013B": "IFD0:Artist",
  "0x013C": "IFD0:HostComputer",
  "0x8298": "IFD0:Copyright",
  "0x829A": "ExifIFD:ExposureTime",
  "0x829D": "ExifIFD:FNumber",
  "0x8827": "ExifIFD:ISO",
  "0x9003": "ExifIFD:DateTimeOriginal",
  "0x9004": "ExifIFD:CreateDate",
  "0x9010": "ExifIFD:OffsetTime",
  "0x9011": "ExifIFD:OffsetTimeOriginal",
  "0x920A": "ExifIFD:FocalLength",
  "0x9286": "ExifIFD:UserComment",
  "0x9290": "ExifIFD:SubSecTime",
  "0xA430": "ExifIFD:OwnerName",
  "0xA431": "ExifIFD:SerialNumber",
  "0xA433": "ExifIFD:LensMake",
  "0xA434": "ExifIFD:LensModel",
  "0xA435": "ExifIFD:LensSerialNumber",
  "0x9C9B": "IFD0:XPTitle",
  "0x9C9C": "IFD0:XPComment",
  "0x9C9D": "IFD0:XPAuthor",
  "0x9C9E": "IFD0:XPKeywords",
  "0x9C9F": "IFD0:XPSubject",
};

/**
 * Performs lossless metadata scrubbing & writing via ExifTool WASM.
 * Returns Uint8Array of the modified file or null to fall back to the built-in engine.
 */
export async function writeWithExifTool(
  file,
  { keptTags = [], keepICC = true, keepOrientation = true } = {}
) {
  const mod = await loadExifTool();
  if (!mod || typeof mod.writeMetadata !== "function") return null;

  try {
    const tagsToWrite = {};
    const extraArgs = ["-all="];
    if (keepICC) {
      extraArgs.push("-tagsFromFile", "@", "-ICC_Profile");
    }
    if (keepOrientation) {
      extraArgs.push("-tagsFromFile", "@", "-Orientation");
    }

    for (const t of keptTags) {
      if (!t?.value) continue;
      if (t.id === "GPS:LOC") {
        const m = String(t.value).match(
          /([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)/
        );
        if (m) {
          const lat = Number.parseFloat(m[1]);
          const lon = Number.parseFloat(m[2]);
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            tagsToWrite.GPSLatitude = String(Math.abs(lat));
            tagsToWrite.GPSLatitudeRef = lat >= 0 ? "N" : "S";
            tagsToWrite.GPSLongitude = String(Math.abs(lon));
            tagsToWrite.GPSLongitudeRef = lon >= 0 ? "E" : "W";
          }
        }
        continue;
      }
      if (t.exiftoolTag) {
        tagsToWrite[t.exiftoolTag] = String(t.value);
        continue;
      }
      const mapped = HEX_TO_EXIFTOOL[String(t.id).toUpperCase()];
      if (mapped) {
        tagsToWrite[mapped] = String(t.value);
      }
    }

    const res = await mod.writeMetadata(file, tagsToWrite, {
      args: extraArgs,
    });
    if (!(res?.success && res.data)) return null;
    return res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data);
  } catch {
    return null;
  }
}
