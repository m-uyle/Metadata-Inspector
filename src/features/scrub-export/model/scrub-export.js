import {
  batch,
  batchEnd,
  batchStart,
  batchTick,
  getActiveItem,
  getBatchItems,
  getOutputFileName,
  notify,
  state,
  verifyBad,
} from "../../../entities/image-file/index.js";
import {
  isGpsRaw,
  isLockedTag,
  isProfileTag,
} from "../../../entities/metadata-tag/index.js";
import {
  buildStoreZipBlob,
  computeRemaining,
  crc32,
  generateCsprngToken,
  independentScan,
  processAsync,
  triggerBlobDownload,
  writeWithExifTool,
} from "../../../shared/lib/index.js";
import { showToast } from "../../../shared/ui/index.js";

export async function scrubSingleItem(item) {
  if (!item) return;
  const keptTags = item.metadataTags.filter(
    (t) => !item.selectedTagUids.has(t.uid)
  );
  const keepICC = keptTags.some(isProfileTag);
  const rawGpsKept = keptTags.some(isGpsRaw);
  const injected = keptTags.filter(
    (t) =>
      !(
        isProfileTag(t) ||
        (isLockedTag(t) && !t.edited) ||
        (t.id === "GPS:LOC" && !t.edited && rawGpsKept) ||
        (isGpsRaw(t) && keptTags.some((g) => g.id === "GPS:LOC" && g.edited))
      )
  );
  const keptVals = new Set(keptTags.map((t) => String(t.value).trim()));
  const keepXmpPacket = keptTags.some((t) => t.id === "XMP");
  const scanTags = item.metadataTags
    .filter(
      (t) =>
        !(isProfileTag(t) || t.isCustom) &&
        item.selectedTagUids.has(t.uid) &&
        !keptVals.has(String(t.value).trim()) &&
        !(keepXmpPacket && t.id.startsWith("XMP:"))
    )
    .map((t) => ({ id: t.id, label: t.label, value: t.value }));

  const outName = getOutputFileName(item);
  const keptSummary = keptTags.map((t) => ({
    id: t.id,
    label: t.label,
    ifd: t.ifd,
  }));

  const needsRawThumbKeep = keptTags.some((t) => t.id === "IFD1:THUMB");
  let cleanedBytes = null;
  let verify = null;
  let cleanCrc;
  let mime = item.mime;

  if (!needsRawThumbKeep) {
    const etBytes = await writeWithExifTool(item.originalFile, {
      keptTags: injected,
      keepICC,
      keepOrientation: true,
    });
    if (etBytes && etBytes.length > 0) {
      cleanedBytes = etBytes;
      cleanCrc = crc32(etBytes);
      try {
        const vr = await processAsync(etBytes.buffer.slice(0), outName, {
          keepICC: true,
          keepOrientation: true,
          inspectOnly: true,
        });
        verify = computeRemaining(vr, keptSummary);
        for (const h of independentScan(etBytes, scanTags)) {
          if (!verify.remaining.some((r) => r.id === h.id)) {
            verify.remaining.push({
              id: h.id,
              label: `${h.label} (found in file)`,
            });
          }
        }
        verify.count = verify.remaining.length;
      } catch {
        verify = { failed: true, remaining: [], count: 0 };
      }
    }
  }

  if (!cleanedBytes) {
    const buffer = await item.originalFile.arrayBuffer();
    const reprocessed = await processAsync(buffer, item.name, {
      keepICC,
      keepOrientation: true,
      customTagsToInject: injected.length > 0 ? injected : null,
      verifyWith: {
        outName,
        keptTags: keptSummary,
        scanTags,
      },
    });
    cleanedBytes = reprocessed.cleanedBytes;
    cleanCrc = reprocessed.cleanCrc;
    mime = reprocessed.mime;
    verify = reprocessed.verify || { remaining: [], count: 0 };
  }

  item.cleanedSize = cleanedBytes.length;
  item.cleanCrc = cleanCrc;
  if (item.cleanUrl) URL.revokeObjectURL(item.cleanUrl);
  item.cleanBlob = new Blob([cleanedBytes], { type: mime });
  item.cleanUrl = URL.createObjectURL(item.cleanBlob);
  item.isCleaned = true;
  item.verify = verify;
}

export async function applyActiveFile() {
  const active = getActiveItem();
  if (!active || active.isCleaned) return false;
  await scrubSingleItem(active);
  notify();
  const hadEdits = active.metadataTags.some((t) => t.edited || t.isCustom);
  showToast(
    verifyBad(active)
      ? `Done (${active.verify.count} ${active.verify.count === 1 ? "field" : "fields"} remaining)`
      : hadEdits
        ? "Changes applied"
        : "Metadata removed"
  );
  return true;
}

export function downloadActiveFile() {
  const active = getActiveItem();
  if (!(active?.isCleaned && active.cleanUrl)) return;
  const filename = getOutputFileName(active);
  triggerBlobDownload(active.cleanUrl, filename);
  showToast(`Downloaded ${filename}`);
}

export async function applyAllPendingFiles() {
  const pending = getBatchItems().filter((i) => !i.isCleaned);
  if (!pending.length || batch.active) return;

  batchStart("Applying", pending.length);
  let done = 0;
  let failedName = null;
  let failedErr = null;
  for (const item of pending) {
    if (batch.cancel) break;
    try {
      await scrubSingleItem(item);
      done++;
    } catch (err) {
      failedName = item.name;
      failedErr = err?.message ? err.message : "processing error";
      break;
    }
    batchTick(done);
    await new Promise((r) => setTimeout(r, 0));
  }
  batchEnd();
  notify();

  if (failedName) {
    showToast(`Stopped on ${failedName}: ${failedErr}`);
  } else {
    showToast(
      batch.cancel
        ? `Stopped after ${done} ${done === 1 ? "file" : "files"}`
        : `Applied to ${done} ${done === 1 ? "file" : "files"}`
    );
  }
}

export async function downloadAllAsZip(itemsOverride) {
  const targets =
    itemsOverride || (state.batchMode ? getBatchItems() : state.items);
  if (!targets.length) return;
  if (batch.active) {
    showToast("Wait for the current task to finish");
    return;
  }

  batchStart("Preparing ZIP", targets.length);
  let zn = 0;
  for (const item of targets) {
    if (batch.cancel) {
      batchEnd();
      notify();
      showToast("ZIP cancelled");
      return;
    }
    if (!item.isCleaned) {
      try {
        await scrubSingleItem(item);
      } catch (err) {
        batchEnd();
        notify();
        const reason = err?.message ? err.message : "error";
        showToast(`ZIP failed on ${item.name} (${reason})`);
        return;
      }
    }
    batchTick(++zn);
    await new Promise((r) => setTimeout(r, 0));
  }
  batchEnd();

  const entries = [];
  for (const item of targets) {
    entries.push({
      name: getOutputFileName(item),
      blob: item.cleanBlob,
      size: item.cleanBlob.size,
      crc:
        item.cleanCrc === undefined
          ? crc32(new Uint8Array(await item.cleanBlob.arrayBuffer()))
          : item.cleanCrc,
    });
  }
  notify();

  const url = URL.createObjectURL(buildStoreZipBlob(entries));
  triggerBlobDownload(
    url,
    `CLEANED_BATCH_${generateCsprngToken().slice(0, 8)}.zip`
  );
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  const unverZip = targets.filter(verifyBad).length;
  showToast(
    unverZip
      ? `Saved ZIP (${unverZip} ${unverZip === 1 ? "file" : "files"} still have metadata)`
      : `Saved ZIP (${entries.length} cleaned files)`
  );
}
