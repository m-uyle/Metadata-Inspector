import {
  batch,
  batchEnd,
  batchStart,
  batchTick,
  notify,
  resetState,
  revokeItemUrls,
  state,
} from "../../../entities/image-file/index.js";
import {
  isLockedTag,
  isProfileTag,
} from "../../../entities/metadata-tag/index.js";
import {
  formatBytes,
  generateCsprngToken,
  inspectWithExifTool,
  processAsync,
} from "../../../shared/lib/index.js";
import { showToast } from "../../../shared/ui/index.js";

const MAX_BYTES = 200 * 1024 * 1024;
const LARGE_SINGLE_FILE_BYTES = 5 * 1024 * 1024;
let importQueue = Promise.resolve();

function mergeExifToolTags(baseTags, etTags) {
  if (!etTags?.length) return baseTags;
  const existingVals = new Set(
    baseTags.map(
      (t) =>
        `${String(t.label).toLowerCase()}|${String(t.value).trim().toLowerCase()}`
    )
  );
  const existingLabels = new Set(
    baseTags.map((t) => String(t.label).toLowerCase())
  );
  const merged = [...baseTags];
  for (const et of etTags) {
    const key = `${et.label.toLowerCase()}|${et.value.trim().toLowerCase()}`;
    if (existingVals.has(key) || existingLabels.has(et.label.toLowerCase())) {
      continue;
    }
    existingVals.add(key);
    existingLabels.add(et.label.toLowerCase());
    merged.push(et);
  }
  return merged;
}

export function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return Promise.resolve();
  const run = importQueue.then(() => processIncomingFiles(files));
  importQueue = run.catch(() => {});
  return run;
}

async function processIncomingFiles(files) {
  while (batch.active) await new Promise((r) => setTimeout(r, 150));

  let count = 0;
  let loaded = 0;
  let dupes = 0;
  batch.cancel = false;
  const showProgress =
    files.length > 1 || (files[0] && files[0].size >= LARGE_SINGLE_FILE_BYTES);
  if (showProgress) batchStart("Importing", files.length);

  for (const file of files) {
    if (batch.cancel) break;
    if (
      state.items.some(
        (it) =>
          it.name === file.name &&
          it.originalSize === file.size &&
          it.originalFile &&
          it.originalFile.lastModified === file.lastModified
      )
    ) {
      dupes++;
      if (showProgress) batchTick(++loaded);
      continue;
    }

    try {
      if (file.size > MAX_BYTES) throw new Error("file larger than 200 MB");
      const buffer = await file.arrayBuffer();
      const [result, etResult] = await Promise.all([
        processAsync(buffer, file.name, {
          keepICC: true,
          keepOrientation: true,
          inspectOnly: true,
        }),
        inspectWithExifTool(file),
      ]);

      const id = `item_${generateCsprngToken()}`;
      const origPreviewUrl = URL.createObjectURL(file);
      const embeddedThumbUrl = result.thumbnailBytes
        ? URL.createObjectURL(
            new Blob([result.thumbnailBytes], { type: "image/jpeg" })
          )
        : null;
      const lastDot = file.name.lastIndexOf(".");
      const initialBaseName =
        lastDot === -1 ? file.name : file.name.slice(0, lastDot);

      const tableTags = mergeExifToolTags(
        [...result.metadataTags],
        etResult ? etResult.tags : null
      );
      if (result.gps) {
        tableTags.unshift({
          id: "GPS:LOC",
          label: "GPS Coordinates",
          category: "Geolocation",
          privacy: true,
          value: `${result.gps.lat}, ${result.gps.lon}`,
          gpsCoordsRaw: `${result.gps.lat}, ${result.gps.lon}`,
        });
      }
      if (result.thumbnailBytes) {
        tableTags.unshift({
          id: "IFD1:THUMB",
          label: "Embedded thumbnail",
          category: "Preview",
          privacy: true,
          value: `JPEG (${formatBytes(result.thumbnailBytes.length)})`,
          thumbUrl: embeddedThumbUrl,
          thumbBytesLength: result.thumbnailBytes.length,
        });
      }

      const enrichedTags = tableTags.map((t, idx) => ({
        ...t,
        uid: `tag_${idx}_${generateCsprngToken().slice(0, 6)}`,
        originalValue: t.value,
        isCustom: false,
      }));

      state.items.unshift({
        id,
        isCleaned: false,
        hasEdits: false,
        customBaseName: `${initialBaseName}_clean`,
        originalFile: file,
        name: file.name,
        origPreviewUrl,
        cleanUrl: null,
        embeddedThumbUrl,
        cleanBlob: null,
        format: result.format,
        ext: result.ext,
        mime: result.mime,
        dimensions: result.dimensions,
        originalSize: result.originalSize,
        baseStrippedSize: result.cleanedSize,
        cleanedSize: result.cleanedSize,
        metadataTags: enrichedTags,
        selectedTagUids: new Set(
          enrichedTags
            .filter((t) => !(isProfileTag(t) || isLockedTag(t)))
            .map((t) => t.uid)
        ),
        gps: result.gps,
        orientation: result.orientation,
        pixelHash: result.pixelHash,
        hasExifSlot: result.hasExifSlot !== false || !!etResult,
      });
      state.selectedId = id;
      count++;
    } catch (err) {
      if (import.meta.env?.DEV) console.warn(err);
      const reason = err?.message ? err.message : "unsupported format";
      showToast(`Couldn't open ${file.name} (${reason})`);
      state.failed.push({
        id: `fail_${generateCsprngToken().slice(0, 8)}`,
        name: file.name,
        reason,
      });
    } finally {
      if (showProgress) batchTick(++loaded);
    }
  }

  batchEnd();
  if (count > 0 || state.failed.length) {
    state.editingTagUid = null;
    notify(["items", "failed", "selectedId", "editingTagUid"]);
    if (count > 0) {
      showToast(
        batch.cancel
          ? `Import stopped: ${count} loaded`
          : `Loaded ${count} ${count === 1 ? "file" : "files"}` +
              (dupes
                ? `, ${dupes} ${dupes === 1 ? "duplicate" : "duplicates"} skipped`
                : "")
      );
    }
  } else if (dupes > 0) {
    showToast(
      dupes === 1
        ? "File is already in the queue"
        : `${dupes} duplicate files skipped`
    );
  }
}

export function removeItem(id) {
  const idx = state.items.findIndex((i) => i.id === id);
  if (idx === -1) return;
  if (state.selectedId === id) state.editingTagUid = null;
  revokeItemUrls(state.items[idx]);
  state.items.splice(idx, 1);
  state.checkedIds.delete(id);
  if (state.checkedIds.size <= 1) {
    state.batchMode = false;
  }
  if (state.selectedId === id) {
    state.selectedId = state.items[0] ? state.items[0].id : null;
  }
  notify(["items", "selectedId", "checkedIds", "batchMode", "editingTagUid"]);
}

export function dismissFailed(id) {
  state.failed = state.failed.filter((x) => x.id !== id);
  notify(["failed"]);
}

export async function clearQueue(confirmFn) {
  if (state.items.length === 0 && state.failed.length === 0) return;
  if (
    (state.items.length > 1 || state.items.some((i) => i.hasEdits)) &&
    !(await confirmFn(
      `Clear ${state.items.length} files from queue? Unsaved changes will be lost.`,
      "Clear queue"
    ))
  ) {
    return;
  }
  resetState();
  showToast("Queue cleared");
}
