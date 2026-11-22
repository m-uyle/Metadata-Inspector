import { EXIF_TAGS, ORIENTATION_TAG_ID } from "../../../shared/lib/index.js";

export const GROUPS = [
  { key: "loc", title: "Location" },
  { key: "prev", title: "Hidden preview" },
  { key: "who", title: "Authors & text" },
  { key: "dev", title: "Device" },
  { key: "time", title: "Date & time" },
  { key: "soft", title: "Software" },
  { key: "tech", title: "Technical" },
];

export const NON_EDIT_IDS = new Set([
  ORIENTATION_TAG_ID,
  "ICC",
  "ICCP",
  "iCCP",
  "XMP",
  "IPTC",
  "0x927C",
  "0x8649",
  "0x83BB",
  "0x8773",
  "IFD1:THUMB",
  "JFIF:THUMB",
  "APP0",
  "pHYs",
  "GIF:APP",
]);

export const isLockedTag = (t) => t.id === ORIENTATION_TAG_ID;

export const isProfileTag = (t) =>
  t.category === "Profile" ||
  t.id === "iCCP" ||
  t.id === "ICC" ||
  t.id === "ICCP";

export const isGpsRaw = (t) => t.ifd === "GPS";

export const isEditableTag = (t) =>
  t.isCustom ||
  (!(
    NON_EDIT_IDS.has(t.id) ||
    String(t.id).startsWith("GIF:APP:") ||
    (t.id === "tIME" && !/^\d{4}:\d{2}:\d{2}/.test(String(t.value)))
  ) &&
    t.category !== "Profile" &&
    !/<(Binary|Compressed) /.test(String(t.value)));

export function groupOf(t) {
  if (isGpsRaw(t) || t.id === "GPS:LOC" || t.category === "Geolocation") {
    return "loc";
  }
  if (
    t.id === "IFD1:THUMB" ||
    t.id === "JFIF:THUMB" ||
    t.category === "Preview"
  ) {
    return "prev";
  }
  if (["Identity", "Description", "Metadata", "Custom"].includes(t.category)) {
    return "who";
  }
  if (["Hardware", "Environment"].includes(t.category) && !isLockedTag(t)) {
    return "dev";
  }
  if (t.category === "Timestamp") return "time";
  if (t.category === "Software") return "soft";
  return "tech";
}

export function sortForDisplay(list) {
  const order = GROUPS.map((g) => g.key);
  const arr = list
    .map((t, i) => [t, i])
    .sort(
      (a, b) =>
        order.indexOf(groupOf(a[0])) - order.indexOf(groupOf(b[0])) ||
        a[1] - b[1]
    )
    .map((x) => x[0]);
  if (!arr.some((t) => t.id === "GPS:LOC")) return arr;
  const raw = arr.filter(isGpsRaw);
  const rest = arr.filter((t) => !isGpsRaw(t));
  rest.splice(rest.findIndex((t) => t.id === "GPS:LOC") + 1, 0, ...raw);
  return rest;
}

export function computeAutoTagMeta(labelStr, currentCat, activeItem) {
  const clean = labelStr.trim().toLowerCase();
  if (
    activeItem &&
    activeItem.format === "GIF" &&
    (clean === "comment" ||
      clean === "gif comment" ||
      currentCat === "Description")
  ) {
    const existingIds = new Set(activeItem.metadataTags.map((t) => t.id));
    if (!existingIds.has("GIF:COM")) {
      return {
        id: "GIF:COM",
        cat: "Description",
        matched: clean === "comment" || clean === "gif comment",
      };
    }
  }
  if (clean) {
    for (const [decId, meta] of Object.entries(EXIF_TAGS)) {
      if (meta.label.toLowerCase() === clean) {
        return {
          id: `0x${Number(decId).toString(16).toUpperCase().padStart(4, "0")}`,
          cat: meta.cat,
          matched: true,
        };
      }
    }
    if (
      clean === "gps" ||
      clean === "gps coordinates" ||
      clean === "location" ||
      clean === "coordinates"
    ) {
      return { id: "GPS:LOC", cat: "Geolocation", matched: true };
    }
  }

  const existingIds = new Set(
    (activeItem ? activeItem.metadataTags : []).map((t) => t.id.toUpperCase())
  );
  const catBaseMap = {
    Identity: 0x013b,
    Description: 0x010e,
    Timestamp: 0x9003,
    Hardware: 0x0110,
    Optics: 0xa434,
    Software: 0x0131,
    Custom: 0x9286,
  };
  if (currentCat === "Geolocation" && !existingIds.has("GPS:LOC")) {
    return { id: "GPS:LOC", cat: currentCat, matched: false };
  }
  if (catBaseMap[currentCat]) {
    const candidateHex = `0x${catBaseMap[currentCat].toString(16).toUpperCase().padStart(4, "0")}`;
    if (!existingIds.has(candidateHex)) {
      return { id: candidateHex, cat: currentCat, matched: false };
    }
  }
  let customSeq = 0xf001;
  while (
    existingIds.has(
      `0x${customSeq.toString(16).toUpperCase().padStart(4, "0")}`
    )
  ) {
    customSeq++;
  }
  return {
    id: `0x${customSeq.toString(16).toUpperCase().padStart(4, "0")}`,
    cat: currentCat,
    matched: false,
  };
}
