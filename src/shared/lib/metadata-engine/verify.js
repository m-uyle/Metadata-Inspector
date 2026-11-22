import { textEncoder } from "../binary.js";

export function computeRemaining(vr, keptTags) {
  const keptIds = new Set(["0x0112", "ICC", "ICCP", "iCCP"]);
  const normalizeId = (id) => String(id).replace(/:(\d+)$/, "");
  const hasInjectedIntoGifCom = keptTags.some(
    (t) =>
      !(
        ["0x0112", "ICC", "ICCP", "iCCP", "GIF:APP", "XMP"].includes(t.id) ||
        String(t.id).startsWith("GIF:APP:")
      )
  );
  const hasInjectedIntoPngText = keptTags.some((t) =>
    ["tEXt", "iTXt", "zTXt", "COM"].includes(normalizeId(t.id))
  );

  for (const t of keptTags) {
    keptIds.add(t.id);
    keptIds.add(normalizeId(t.id));
    if (t.id === "XMP:Tool") keptIds.add("0x0131");
    if (t.id === "XMP:Author") keptIds.add("0x013B");
    if (t.id === "XMP:RawFile") keptIds.add("0x010E");
    if (t.id === "XMP:Serial") keptIds.add("0xA431");
    if (t.id === "XMP:Lens") keptIds.add("0xA434");
    if (t.id === "COM") keptIds.add("0x9286");
    if (t.id === "XMP") {
      for (const xid of [
        "XMP:Tool",
        "XMP:Author",
        "XMP:RawFile",
        "XMP:Serial",
        "XMP:Lens",
      ]) {
        keptIds.add(xid);
      }
    }
  }

  if (vr.format === "GIF" && hasInjectedIntoGifCom) keptIds.add("GIF:COM");
  if ((vr.format === "PNG" || vr.format === "APNG") && hasInjectedIntoPngText) {
    keptIds.add("tEXt");
    keptIds.add("iTXt");
  }

  const keepGps = keptTags.some((t) => t.id === "GPS:LOC" || t.ifd === "GPS");
  const keepThumb = keptTags.some((t) => t.id === "IFD1:THUMB");
  const rem = vr.metadataTags
    .filter(
      (t) =>
        t.value !== "" &&
        !keptIds.has(t.id) &&
        !keptIds.has(normalizeId(t.id)) &&
        !(keepGps && t.ifd === "GPS")
    )
    .map((t) => ({ id: t.id, label: t.label }));

  if (vr.thumbnailBytes && !keepThumb) {
    rem.push({ id: "IFD1:THUMB", label: "Embedded preview" });
  }
  return { remaining: rem, count: rem.length };
}

export function independentScan(bytes, tags) {
  if (!(bytes?.length && Array.isArray(tags) && tags.length)) {
    return [];
  }
  const find = (hay, needle) => {
    const first = needle[0];
    let i = hay.indexOf(first);
    while (i >= 0 && i <= hay.length - needle.length) {
      let j = 1;
      while (j < needle.length && hay[i + j] === needle[j]) j++;
      if (j === needle.length) return i;
      i = hay.indexOf(first, i + 1);
    }
    return -1;
  };

  const hits = [];
  for (const t of tags) {
    const v = String(t.value ?? "").trim();
    if (
      v.length < 6 ||
      /^<Binary|^<Compressed/.test(v) ||
      /^[\d.\s,:-]+$/.test(v)
    ) {
      continue;
    }
    const variants = [textEncoder.encode(v)];
    const l1 = new Uint8Array(v.length);
    let latin = true;
    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i);
      if (c > 255) {
        latin = false;
        break;
      }
      l1[i] = c;
    }
    if (latin) variants.push(l1);
    const u16 = new Uint8Array(v.length * 2);
    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i);
      u16[2 * i] = c & 255;
      u16[2 * i + 1] = c >> 8;
    }
    variants.push(u16);
    if (variants.some((p) => find(bytes, p) >= 0)) hits.push(t);
  }
  return hits;
}
