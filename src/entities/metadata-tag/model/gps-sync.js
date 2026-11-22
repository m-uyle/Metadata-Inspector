import {
  CORE_GPS_IDS,
  decimalToDMSRationals,
} from "../../../shared/lib/index.js";

const SOUTH_REF_RE = /^s$/iu;
const WEST_REF_RE = /^w$/iu;

export function syncRawGpsSubTags(item, latLonStr, markEdited) {
  if (!item) {
    return;
  }
  const parts = String(latLonStr || "")
    .split(",")
    .map((s) => Number.parseFloat(s.trim()));
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
    return;
  }
  const [lat, lon] = parts;
  const latDms = decimalToDMSRationals(lat)
    .map(([n, d]) => Number((n / d).toFixed(4)))
    .join(", ");
  const lonDms = decimalToDMSRationals(lon)
    .map(([n, d]) => Number((n / d).toFixed(4)))
    .join(", ");
  const mapVals = {
    "0x0001": lat >= 0 ? "N" : "S",
    "0x0002": latDms,
    "0x0003": lon >= 0 ? "E" : "W",
    "0x0004": lonDms,
  };
  for (const t of item.metadataTags) {
    if (mapVals[t.id] !== undefined) {
      t.value = mapVals[t.id];
      t.edited = t.value !== t.originalValue;
      if (markEdited) item.selectedTagUids.delete(t.uid);
    }
  }
}

export function syncGpsLocFromRawSubTags(item, keepCoordinateGroup = false) {
  if (!item) {
    return;
  }
  const getVal = (id) => {
    const t = item.metadataTags.find((x) => x.id === id);
    return t ? String(t.value || "").trim() : "";
  };
  const parseDms = (str) => {
    const nums = str.split(",").map((x) => Number.parseFloat(x.trim()));
    if (nums.length < 2 || nums.some(Number.isNaN)) {
      return null;
    }
    return (nums[0] || 0) + (nums[1] || 0) / 60 + (nums[2] || 0) / 3600;
  };
  const latAbs = parseDms(getVal("0x0002"));
  const lonAbs = parseDms(getVal("0x0004"));
  const gpsLoc = item.metadataTags.find((x) => x.id === "GPS:LOC");
  if (latAbs !== null && lonAbs !== null && gpsLoc) {
    const lat = SOUTH_REF_RE.test(getVal("0x0001")) ? -latAbs : latAbs;
    const lon = WEST_REF_RE.test(getVal("0x0003")) ? -lonAbs : lonAbs;
    const formatted = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    gpsLoc.value = formatted;
    gpsLoc.gpsCoordsRaw = formatted;
    gpsLoc.edited = formatted !== gpsLoc.originalValue;
  }
  if (keepCoordinateGroup) {
    if (gpsLoc) {
      item.selectedTagUids.delete(gpsLoc.uid);
    }
    for (const t of item.metadataTags) {
      if (CORE_GPS_IDS.has(t.id)) {
        item.selectedTagUids.delete(t.uid);
      }
    }
  }
}
