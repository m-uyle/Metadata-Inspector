import {
  batch,
  getBatchItems,
  invalidateCleanState,
  notify,
  state,
} from "../../../entities/image-file/index.js";
import {
  groupOf,
  isLockedTag,
  isProfileTag,
  syncRawGpsSubTags,
  validateTagValue,
} from "../../../entities/metadata-tag/index.js";
import {
  generateCsprngToken,
  safeFileBase,
  sanitizeString,
} from "../../../shared/lib/index.js";
import { showToast } from "../../../shared/ui/index.js";

function applyTagValueLocal(item, tag, value) {
  tag.value = value;
  tag.edited = value !== tag.originalValue;
  if (tag.id === "GPS:LOC") {
    tag.gpsCoordsRaw = value;
    syncRawGpsSubTags(item, value, tag.edited);
  }
  if (tag.edited) {
    item.selectedTagUids.delete(tag.uid);
  } else if (!(isProfileTag(tag) || isLockedTag(tag))) {
    item.selectedTagUids.add(tag.uid);
  }
  item.hasEdits = item.metadataTags.some((t) => t.edited || t.isCustom);
  invalidateCleanState(item);
}

export function computeRenameCandidate(item, tpl, index, randFactory) {
  const base = String(item?.name || "").replace(/\.[^.]+$/, "");
  const tags = Array.isArray(item?.metadataTags) ? item.metadataTags : [];
  const dt = ["0x9003", "0x9004", "0x0132", "tIME"]
    .map((id) => tags.find((t) => t.id === id))
    .find((t) => t && /^\d{4}:\d{2}:\d{2}/.test(String(t.value)));
  const date = dt
    ? String(dt.value).slice(0, 10).replace(/:/g, "-")
    : "undated";
  const getRand =
    randFactory ||
    (() => {
      if (!state.previewRandToken) {
        state.previewRandToken = generateCsprngToken()
          .slice(0, 6)
          .toUpperCase();
      }
      return state.previewRandToken;
    });
  const out = String(tpl || "")
    .replace(/\{name\}/g, () => base)
    .replace(/\{n(\d)?\}/g, (_, w) => String(index).padStart(w ? +w : 3, "0"))
    .replace(/\{date\}/g, () => date)
    .replace(/\{rand\}/g, () => getRand());
  return safeFileBase(out);
}

export function applyRenameTemplate(tpl) {
  if (batch.active) {
    showToast("Wait for the current task to finish");
    return;
  }
  if (!String(tpl).trim()) {
    showToast("Enter a name template");
    return;
  }
  const targets = getBatchItems();
  const used = new Set();
  let i = 0;
  let first = "";
  for (const item of targets) {
    i++;
    const out = computeRenameCandidate(item, tpl, i, () =>
      generateCsprngToken().slice(0, 6).toUpperCase()
    );
    let cand = out;
    let k = 2;
    while (used.has((cand + (item.ext || "")).toLowerCase())) {
      cand = `${out}_${k++}`;
    }
    used.add((cand + (item.ext || "")).toLowerCase());
    item.customBaseName = cand;
    if (i === 1) first = cand + (item.ext || "");
  }
  notify();
  showToast(
    `Renamed ${targets.length} ${targets.length === 1 ? "file" : "files"} (e.g. ${first})`
  );
}

export function setFieldAll(spec, value) {
  if (batch.active) {
    showToast("Wait for the current task to finish");
    return;
  }
  const [id, category, label] = spec.split("|");
  const v = sanitizeString(String(value).trim());
  if (!v) {
    showToast("Enter a value first");
    return;
  }
  const res = validateTagValue(
    { id, category, label, isCustom: true, originalValue: "" },
    v
  );
  if (!res.ok) {
    showToast(res.error);
    return;
  }

  let appliedFiles = 0;
  let skippedFiles = 0;
  for (const item of getBatchItems()) {
    if (!item.hasExifSlot) {
      skippedFiles++;
      continue;
    }
    appliedFiles++;
    const existing = item.metadataTags.find((t) => t.id === id);
    if (existing) {
      applyTagValueLocal(item, existing, sanitizeString(res.value));
    } else {
      item.metadataTags.push({
        uid: `tag_custom_${generateCsprngToken()}`,
        id,
        category,
        label,
        value: sanitizeString(res.value),
        originalValue: "",
        privacy: false,
        edited: true,
        isCustom: true,
      });
      item.hasEdits = true;
      invalidateCleanState(item);
    }
  }
  notify();
  showToast(
    appliedFiles
      ? `${label} set on ${appliedFiles} ${appliedFiles === 1 ? "file" : "files"}` +
          (skippedFiles ? ` (${skippedFiles} skipped)` : "")
      : "Selected files don't support adding fields"
  );
}

function toggleTagsMatching(predicate, checked) {
  for (const item of getBatchItems()) {
    for (const t of item.metadataTags) {
      if (!isLockedTag(t) && predicate(t)) {
        if (checked) {
          item.selectedTagUids.add(t.uid);
        } else {
          item.selectedTagUids.delete(t.uid);
        }
      }
    }
    invalidateCleanState(item);
  }
  notify();
}

export function toggleBatchMaster(checked) {
  toggleTagsMatching(() => true, checked);
}

export function toggleBatchGroup(groupKey, checked) {
  toggleTagsMatching((t) => groupOf(t) === groupKey, checked);
}
