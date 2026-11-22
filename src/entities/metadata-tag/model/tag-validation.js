import { EXIF_TAGS } from "../../../shared/lib/index.js";

export function validateTagValue(tag, raw) {
  const v = String(raw ?? "").trim();
  const fail = (error) => ({ ok: false, error });
  const ok = (value) => ({ ok: true, value });

  if (v === "") return ok("");
  if (v === String(tag.originalValue ?? "").trim()) return ok(v);

  const pad = (n) => String(n).padStart(2, "0");
  const id = tag.id;

  if (id === "GPS:LOC") {
    const m = v
      .replace(/°/g, "")
      .match(
        /^([+-]?\d+(?:\.\d+)?)\s*([NSns])?\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)\s*([EWew])?$/
      );
    if (!m) {
      return fail("Use decimal coordinates, e.g. 60.170833, 24.938444");
    }
    let lat = Number.parseFloat(m[1]);
    let lon = Number.parseFloat(m[3]);
    if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat);
    if (m[4] && /w/i.test(m[4])) lon = -Math.abs(lon);
    if (!(lat >= -90 && lat <= 90)) {
      return fail("Latitude must be between -90 and 90");
    }
    if (!(lon >= -180 && lon <= 180)) {
      return fail("Longitude must be between -180 and 180");
    }
    return ok(`${lat.toFixed(6)}, ${lon.toFixed(6)}`);
  }

  const numId =
    typeof id === "string" && /^0x[0-9a-f]{1,4}$/i.test(id)
      ? Number.parseInt(id, 16)
      : null;
  const isGps =
    tag.ifd === "GPS" ||
    (tag.category === "Geolocation" && numId !== null && numId <= 0x1f);

  if (isGps && numId !== null) {
    if (numId === 0x0001 || numId === 0x0003) {
      const want = numId === 0x0001 ? /^[NS]$/i : /^[EW]$/i;
      return want.test(v)
        ? ok(v.toUpperCase())
        : fail(numId === 0x0001 ? "Use N or S" : "Use E or W");
    }
    if (numId === 0x0002 || numId === 0x0004) {
      const m = v.match(
        /^(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)$/
      );
      if (!m) {
        return fail("Use degrees, minutes, seconds: e.g. 60, 10, 14.9988");
      }
      const [d, mi, se] = [m[1], m[2], m[3]].map(Number.parseFloat);
      const maxDeg = numId === 0x0002 ? 90 : 180;
      if (d > maxDeg) return fail(`Degrees must be 0-${maxDeg}`);
      if (mi >= 60 || se >= 60) {
        return fail("Minutes and seconds must be below 60");
      }
      if (d === maxDeg && (mi > 0 || se > 0)) {
        return fail(`Coordinates cannot exceed ${maxDeg}° 0' 0"`);
      }
      return ok(`${m[1]}, ${m[2]}, ${m[3]}`);
    }
  }

  if (
    numId === 0x0132 ||
    numId === 0x9003 ||
    numId === 0x9004 ||
    id === "tIME"
  ) {
    const m = v.match(
      /^(\d{4})[:\-/](\d{2})[:\-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
    );
    const bad = "Use YYYY:MM:DD HH:MM:SS, e.g. 2026:10:24 15:30:12";
    if (!m) return fail(bad);
    const [Y, Mo, D, H, Mi, S] = m.slice(1).map(Number);
    const dim = new Date(Date.UTC(Y, Mo, 0)).getUTCDate();
    if (
      Y < 1800 ||
      Mo < 1 ||
      Mo > 12 ||
      D < 1 ||
      D > dim ||
      H > 23 ||
      Mi > 59 ||
      S > 59
    ) {
      return fail(`That date/time does not exist. ${bad}`);
    }
    return ok(`${Y}:${pad(Mo)}:${pad(D)} ${pad(H)}:${pad(Mi)}:${pad(S)}`);
  }

  if (numId === 0x9010 || numId === 0x9011 || numId === 0x882a) {
    return /^[+-](0\d|1[0-4]):[0-5]\d$/.test(v)
      ? ok(v)
      : fail("Use a UTC offset like +02:00 or -05:00");
  }
  if (numId === 0x9290 || numId === 0x9291 || numId === 0x9292) {
    return /^\d{1,9}$/.test(v) ? ok(v) : fail("Digits only, e.g. 842");
  }
  if (numId === 0x0112) {
    return /^[1-8]$/.test(v)
      ? ok(v)
      : fail("Orientation must be a number from 1 to 8");
  }
  if (numId !== null && numId >= 0x9c9b && numId <= 0x9c9f) return ok(v);

  const meta = numId === null ? null : EXIF_TAGS[numId];
  const type = meta ? meta.type : tag.rawType;
  if (type === 3 || type === 4) {
    if (!/^\d+(\s*,\s*\d+)*$/.test(v)) {
      return fail("Use whole numbers, e.g. 100 or 1, 2");
    }
    const max = type === 3 ? 65535 : 4294967295;
    if (v.split(",").some((x) => Number.parseInt(x, 10) > max)) {
      return fail(`Maximum value is ${max}`);
    }
    return ok(
      v
        .split(",")
        .map((x) => String(Number.parseInt(x, 10)))
        .join(", ")
    );
  }

  if (type === 5) {
    const parts = v
      .replace(/\s*\([^)]*\)\s*$/, "")
      .split(",")
      .map((x) => x.trim());
    const out = [];
    for (const p of parts) {
      const fr = p.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (fr) {
        if (Number.parseInt(fr[2], 10) === 0) {
          return fail("Denominator cannot be 0");
        }
        out.push(`${fr[1]}/${fr[2]}`);
      } else if (/^\d+(\.\d+)?$/.test(p)) {
        out.push(p);
      } else {
        return fail("Use a number or fraction, e.g. 2.8 or 1/250");
      }
    }
    return ok(out.join(", "));
  }

  return ok(v);
}
