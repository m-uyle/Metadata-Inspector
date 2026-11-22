import { concatUint8Arrays, crc32, textEncoder } from "../binary.js";

export function buildStoreZipBlob(filesList) {
  const localParts = [];
  const centralHeaders = [];
  const usedNames = new Set();
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  const unsafeCharsRe = /[<>:"/\\|?*\x00-\x1f]+/g;
  const sanitizeZipEntryName = (raw) => {
    const cleaned = String(raw || "")
      .replace(unsafeCharsRe, "_")
      .replace(/\.{2,}/g, ".")
      .replace(/^[. ]+|[. ]+$/g, "");
    if (!cleaned) return "file.bin";
    const dot = cleaned.lastIndexOf(".");
    let base = dot > 0 ? cleaned.slice(0, dot) : cleaned;
    const ext = dot > 0 ? cleaned.slice(dot).slice(0, 16) : "";
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base += "_";
    base = base.slice(0, 120) || "file";
    return `${base}${ext}`;
  };

  for (const f of filesList) {
    let uniqueName = sanitizeZipEntryName(f.name);
    if (usedNames.has(uniqueName.toLowerCase())) {
      const dotIdx = uniqueName.lastIndexOf(".");
      const base = dotIdx === -1 ? uniqueName : uniqueName.slice(0, dotIdx);
      const ext = dotIdx === -1 ? "" : uniqueName.slice(dotIdx);
      let idx = 2;
      while (usedNames.has(`${base}_${idx}${ext}`.toLowerCase())) idx++;
      uniqueName = `${base}_${idx}${ext}`;
    }
    usedNames.add(uniqueName.toLowerCase());

    const nameBytes = textEncoder.encode(uniqueName);
    const byteSize = f.size === undefined ? f.data.length : f.size;
    const crc = f.crc === undefined ? crc32(f.data) : f.crc;

    const needLocalZip64 = byteSize >= 0xffffffff;
    const localExtraLen = needLocalZip64 ? 20 : 0;
    const lfh = new Uint8Array(30 + nameBytes.length + localExtraLen);
    const lView = new DataView(lfh.buffer);
    lView.setUint32(0, 0x04034b50, true);
    lView.setUint16(4, needLocalZip64 ? 45 : 20, true);
    lView.setUint16(6, 0x0800, true);
    lView.setUint16(10, dosTime, true);
    lView.setUint16(12, dosDate, true);
    lView.setUint32(14, crc, true);
    lView.setUint32(18, needLocalZip64 ? 0xffffffff : byteSize, true);
    lView.setUint32(22, needLocalZip64 ? 0xffffffff : byteSize, true);
    lView.setUint16(26, nameBytes.length, true);
    lView.setUint16(28, localExtraLen, true);
    lfh.set(nameBytes, 30);
    if (needLocalZip64) {
      const exPos = 30 + nameBytes.length;
      lView.setUint16(exPos, 0x0001, true);
      lView.setUint16(exPos + 2, 16, true);
      lView.setBigUint64(exPos + 4, BigInt(byteSize), true);
      lView.setBigUint64(exPos + 12, BigInt(byteSize), true);
    }
    localParts.push(lfh, f.blob || f.data);

    const useZip64 = offset >= 0xffffffff || byteSize >= 0xffffffff;
    const extraLen = useZip64 ? 28 : 0;
    const cdh = new Uint8Array(46 + nameBytes.length + extraLen);
    const cView = new DataView(cdh.buffer);
    cView.setUint32(0, 0x02014b50, true);
    cView.setUint16(4, useZip64 ? 45 : 20, true);
    cView.setUint16(6, useZip64 ? 45 : 20, true);
    cView.setUint16(8, 0x0800, true);
    cView.setUint16(12, dosTime, true);
    cView.setUint16(14, dosDate, true);
    cView.setUint32(16, crc, true);
    cView.setUint32(20, useZip64 ? 0xffffffff : byteSize, true);
    cView.setUint32(24, useZip64 ? 0xffffffff : byteSize, true);
    cView.setUint16(28, nameBytes.length, true);
    cView.setUint16(30, extraLen, true);
    cView.setUint32(42, useZip64 ? 0xffffffff : offset, true);
    cdh.set(nameBytes, 46);
    if (useZip64) {
      const exPos = 46 + nameBytes.length;
      cView.setUint16(exPos, 0x0001, true);
      cView.setUint16(exPos + 2, 24, true);
      cView.setBigUint64(exPos + 4, BigInt(byteSize), true);
      cView.setBigUint64(exPos + 12, BigInt(byteSize), true);
      cView.setBigUint64(exPos + 20, BigInt(offset), true);
    }
    centralHeaders.push(cdh);
    offset += lfh.length + byteSize;
  }

  const cdData = concatUint8Arrays(centralHeaders);
  const needZip64Eocd = offset >= 0xffffffff || filesList.length >= 0xffff;
  const tailParts = [cdData];
  if (needZip64Eocd) {
    const z64 = new Uint8Array(56);
    const zv = new DataView(z64.buffer);
    zv.setUint32(0, 0x06064b50, true);
    zv.setBigUint64(4, 44n, true);
    zv.setUint16(12, 45, true);
    zv.setUint16(14, 45, true);
    zv.setBigUint64(24, BigInt(filesList.length), true);
    zv.setBigUint64(32, BigInt(filesList.length), true);
    zv.setBigUint64(40, BigInt(cdData.length), true);
    zv.setBigUint64(48, BigInt(offset), true);
    const loc = new Uint8Array(20);
    const lv = new DataView(loc.buffer);
    lv.setUint32(0, 0x07064b50, true);
    lv.setBigUint64(8, BigInt(offset + cdData.length), true);
    lv.setUint32(16, 1, true);
    tailParts.push(z64, loc);
  }

  const eocd = new Uint8Array(22);
  const eView = new DataView(eocd.buffer);
  eView.setUint32(0, 0x06054b50, true);
  eView.setUint16(8, Math.min(0xffff, filesList.length), true);
  eView.setUint16(10, Math.min(0xffff, filesList.length), true);
  eView.setUint32(12, Math.min(0xffffffff, cdData.length), true);
  eView.setUint32(16, Math.min(0xffffffff, offset), true);
  tailParts.push(eocd);

  return new Blob([...localParts, ...tailParts], {
    type: "application/zip",
  });
}
