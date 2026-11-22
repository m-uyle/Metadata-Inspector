import {
  getActiveItem,
  invalidateCleanState,
  notify,
  state,
} from "../../../entities/image-file/index.js";
import {
  groupOf,
  isGpsRaw,
  isLockedTag,
  isProfileTag,
  syncGpsLocFromRawSubTags,
  syncRawGpsSubTags,
  validateTagValue,
} from "../../../entities/metadata-tag/index.js";
import {
  CORE_GPS_IDS,
  generateCsprngToken,
  sanitizeString,
} from "../../../shared/lib/index.js";
import { showToast } from "../../../shared/ui/index.js";

export function setTagValueOn(item, tag, value) {
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

export function deleteTag(tagUid) {
  const active = getActiveItem();
  if (!active) return;
  active.metadataTags = active.metadataTags.filter((t) => t.uid !== tagUid);
  active.selectedTagUids.delete(tagUid);
  active.hasEdits = active.metadataTags.some((t) => t.edited || t.isCustom);
  invalidateCleanState(active);
  notify();
  showToast("Field deleted");
}

export function resetTagValue(tagUid) {
  const active = getActiveItem();
  if (!active) return;
  const tag = active.metadataTags.find((t) => t.uid === tagUid);
  if (!tag || tag.originalValue === undefined) return;

  tag.value = tag.originalValue;
  tag.edited = false;
  if (!(isProfileTag(tag) || isLockedTag(tag))) {
    active.selectedTagUids.add(tag.uid);
  }
  if (tag.id === "GPS:LOC") {
    tag.gpsCoordsRaw = tag.originalValue;
    active.metadataTags.filter(isGpsRaw).forEach((gt) => {
      if (gt.originalValue !== undefined) gt.value = gt.originalValue;
      gt.edited = false;
      active.selectedTagUids.add(gt.uid);
    });
  } else if (CORE_GPS_IDS.has(tag.id)) {
    syncGpsLocFromRawSubTags(active, false);
    const gpsLoc = active.metadataTags.find((x) => x.id === "GPS:LOC");
    const allRawReset = active.metadataTags
      .filter((x) => CORE_GPS_IDS.has(x.id))
      .every((x) => !x.edited);
    if (allRawReset && gpsLoc && !gpsLoc.edited) {
      active.selectedTagUids.add(gpsLoc.uid);
      for (const x of active.metadataTags) {
        if (CORE_GPS_IDS.has(x.id)) active.selectedTagUids.add(x.uid);
      }
    }
  }
  active.hasEdits = active.metadataTags.some((t) => t.edited || t.isCustom);
  invalidateCleanState(active);
  notify();
  showToast(`Reset ${tag.label}`);
}

export function resetActiveFile() {
  const active = getActiveItem();
  if (!active) return;
  state.editingTagUid = null;
  active.metadataTags = active.metadataTags.filter((t) => !t.isCustom);
  active.metadataTags.forEach((t) => {
    if (t.originalValue !== undefined) t.value = t.originalValue;
    if (t.id === "GPS:LOC") t.gpsCoordsRaw = t.originalValue;
    t.edited = false;
  });
  active.selectedTagUids = new Set(
    active.metadataTags
      .filter((t) => !(isProfileTag(t) || isLockedTag(t)))
      .map((t) => t.uid)
  );
  active.hasEdits = false;
  invalidateCleanState(active);
  notify();
  showToast("Metadata reset");
}

export function removeAllGpsOnActive() {
  const active = getActiveItem();
  if (!active) return;
  active.metadataTags.forEach((t) => {
    if (t.id === "GPS:LOC" || isGpsRaw(t)) {
      active.selectedTagUids.add(t.uid);
      if (t.id === "GPS:LOC" || isGpsRaw(t)) {
        if (t.originalValue !== undefined) t.value = t.originalValue;
        if (t.id === "GPS:LOC") t.gpsCoordsRaw = t.originalValue;
        t.edited = false;
      }
    }
  });
  active.hasEdits = active.metadataTags.some((t) => t.edited || t.isCustom);
  invalidateCleanState(active);
  state.editingTagUid = null;
  notify();
  showToast("GPS marked for removal");
}

export function saveInlineEdit(tagUid, newVal) {
  const active = getActiveItem();
  if (!active) return { ok: true };
  const tag = active.metadataTags.find((t) => t.uid === tagUid);
  if (!tag) {
    state.editingTagUid = null;
    notify();
    return { ok: true };
  }

  const res = validateTagValue(tag, sanitizeString(newVal));
  if (!res.ok) return { ok: false, error: res.error };

  if (res.value === "") {
    if (isLockedTag(tag)) {
      return {
        ok: false,
        error: "Orientation is kept so the photo stays upright",
      };
    }
    state.editingTagUid = null;
    if (tag.isCustom) {
      deleteTag(tag.uid);
      showToast("Field deleted");
      return { ok: true };
    }
    tag.value = tag.originalValue;
    if (tag.id === "GPS:LOC") tag.gpsCoordsRaw = tag.originalValue;
    tag.edited = false;
    active.selectedTagUids.add(tag.uid);
    if (tag.id === "GPS:LOC") {
      for (const t of active.metadataTags) {
        if (isGpsRaw(t)) active.selectedTagUids.add(t.uid);
      }
    }
    active.hasEdits = active.metadataTags.some((t) => t.edited || t.isCustom);
    invalidateCleanState(active);
    notify();
    const partialGps =
      isGpsRaw(tag) &&
      active.metadataTags.some(
        (t) => isGpsRaw(t) && !active.selectedTagUids.has(t.uid)
      );
    showToast(
      partialGps
        ? "Marked for removal (other GPS fields kept)"
        : "Field marked for removal"
    );
    return { ok: true };
  }

  tag.value = sanitizeString(res.value);
  const wasEdited = !!tag.edited;
  tag.edited = tag.value !== tag.originalValue;
  if (tag.id === "GPS:LOC") {
    tag.gpsCoordsRaw = tag.value;
    syncRawGpsSubTags(active, tag.value, tag.edited);
  } else if (CORE_GPS_IDS.has(tag.id)) {
    syncGpsLocFromRawSubTags(active, tag.edited);
  }
  if (tag.edited) {
    active.selectedTagUids.delete(tag.uid);
  } else if (wasEdited && !(isProfileTag(tag) || isLockedTag(tag))) {
    active.selectedTagUids.add(tag.uid);
  }
  active.hasEdits = active.metadataTags.some((t) => t.edited || t.isCustom);
  invalidateCleanState(active);
  state.editingTagUid = null;
  notify();
  return { ok: true };
}

export function toggleTagSelection(tagUid, checked) {
  const active = getActiveItem();
  if (!(active && tagUid)) return;
  const targets = [tagUid];
  const clicked = active.metadataTags.find((t) => t.uid === tagUid);
  if (clicked && clicked.id === "GPS:LOC") {
    for (const t of active.metadataTags) {
      if (isGpsRaw(t)) targets.push(t.uid);
    }
  }
  if (clicked && CORE_GPS_IDS.has(clicked.id)) {
    for (const t of active.metadataTags) {
      if (CORE_GPS_IDS.has(t.id) || t.id === "GPS:LOC") targets.push(t.uid);
    }
  }
  if (clicked && clicked.id === "XMP") {
    for (const t of active.metadataTags) {
      if (t.id.startsWith("XMP:")) targets.push(t.uid);
    }
  }
  for (const u of targets) {
    if (checked) active.selectedTagUids.add(u);
    else active.selectedTagUids.delete(u);
  }
  if (clicked && isGpsRaw(clicked) && !CORE_GPS_IDS.has(clicked.id)) {
    const gpsLoc = active.metadataTags.find((t) => t.id === "GPS:LOC");
    if (gpsLoc) {
      const allRawChecked = active.metadataTags
        .filter(isGpsRaw)
        .every((t) => active.selectedTagUids.has(t.uid));
      if (allRawChecked) active.selectedTagUids.add(gpsLoc.uid);
      else active.selectedTagUids.delete(gpsLoc.uid);
    }
  }
  invalidateCleanState(active);
  notify();
}

export function toggleGroupSelection(groupKey) {
  const active = getActiveItem();
  if (!active) return;
  const members = active.metadataTags.filter(
    (t) => groupOf(t) === groupKey && !isLockedTag(t)
  );
  const allSel = members.every((t) => active.selectedTagUids.has(t.uid));
  for (const t of members) {
    if (allSel) active.selectedTagUids.delete(t.uid);
    else active.selectedTagUids.add(t.uid);
  }
  invalidateCleanState(active);
  notify();
}

export function toggleMasterSelection(checked) {
  const active = getActiveItem();
  if (!active) return;
  const visibleTags =
    state.categoryFilter === "ALL"
      ? active.metadataTags
      : active.metadataTags.filter(
          (t) => t.category.toLowerCase() === state.categoryFilter.toLowerCase()
        );
  for (const t of visibleTags) {
    if (!isLockedTag(t)) {
      if (checked) active.selectedTagUids.add(t.uid);
      else active.selectedTagUids.delete(t.uid);
    }
  }
  invalidateCleanState(active);
  notify();
}

export function applyEditsToAllQueue() {
  const active = getActiveItem();
  if (!active || state.items.length < 2) return;
  const hasEditedGpsLoc = active.metadataTags.some(
    (t) => t.id === "GPS:LOC" && (t.edited || t.isCustom)
  );
  const editedTags = active.metadataTags.filter(
    (t) =>
      (t.edited || t.isCustom) && !(hasEditedGpsLoc && CORE_GPS_IDS.has(t.id))
  );
  if (!editedTags.length) {
    showToast("No edits or custom fields to copy");
    return;
  }

  let affectedCount = 0;
  let skippedNoSlot = 0;
  for (const item of state.items) {
    if (item.id === active.id) continue;
    if (!item.hasExifSlot) {
      skippedNoSlot++;
      continue;
    }
    let modifiedAny = false;
    for (const edTag of editedTags) {
      if (edTag.id === "IFD1:THUMB") continue;
      if (
        item.format === "GIF" &&
        (edTag.id === "GPS:LOC" || isGpsRaw(edTag))
      ) {
        continue;
      }
      const existing = item.metadataTags.find((t) => t.id === edTag.id);
      if (existing) {
        existing.value = edTag.value;
        if (existing.id === "GPS:LOC") existing.gpsCoordsRaw = edTag.value;
        existing.edited = existing.value !== existing.originalValue;
        item.selectedTagUids.delete(existing.uid);
        modifiedAny = true;
      } else {
        const newTag = {
          uid: `tag_custom_${generateCsprngToken()}`,
          id: edTag.id,
          category: edTag.category,
          label: edTag.label,
          ifd: edTag.ifd,
          rawType: edTag.rawType,
          value: edTag.value,
          gpsCoordsRaw: edTag.id === "GPS:LOC" ? edTag.value : undefined,
          originalValue: "",
          privacy: false,
          edited: true,
          isCustom: true,
        };
        item.metadataTags.push(newTag);
        item.selectedTagUids.delete(newTag.uid);
        modifiedAny = true;
      }
      if (edTag.id === "GPS:LOC") syncRawGpsSubTags(item, edTag.value, true);
    }
    if (modifiedAny) {
      item.hasEdits = item.metadataTags.some((t) => t.edited || t.isCustom);
      invalidateCleanState(item);
      affectedCount++;
    }
  }
  notify();
  showToast(
    `Copied ${editedTags.length} ${editedTags.length === 1 ? "edit" : "edits"} to ${affectedCount} ${affectedCount === 1 ? "file" : "files"}` +
      (skippedNoSlot ? ` (${skippedNoSlot} skipped)` : "")
  );
}

export function addOrUpdateCustomTag({
  id,
  cat,
  label,
  value,
  isCustom,
  hasCustomLabel,
}) {
  const active = getActiveItem();
  if (!active) return { ok: false, error: "No active file selected" };

  if (
    !/^(0x[0-9a-fA-F]{1,4}|COM|tEXt|iTXt|GIF:COM|GPS:LOC|[A-Za-z0-9_]+:[A-Za-z0-9_]+)$/.test(
      id
    ) ||
    [
      "0x0000",
      "0x8769",
      "0x8825",
      "0xA005",
      "0xa005",
      "0x014A",
      "0x014a",
    ].includes(id)
  ) {
    return {
      ok: false,
      field: "id",
      error: "Enter a 4-digit hex ID like 0x013B",
    };
  }

  const vres = validateTagValue(
    { id, category: cat, label, isCustom: true, originalValue: "" },
    value
  );
  if (!vres.ok) {
    return { ok: false, field: "value", error: vres.error };
  }

  const cleanValue = sanitizeString(vres.value);
  const existing = active.metadataTags.find(
    (t) => t.id.toUpperCase() === id.toUpperCase()
  );
  let targetCat = cat;
  if (existing && !existing.isCustom) {
    if (isCustom && hasCustomLabel) existing.label = label;
    setTagValueOn(active, existing, cleanValue);
    targetCat = existing.category;
  } else {
    if (existing) {
      active.selectedTagUids.delete(existing.uid);
      active.metadataTags = active.metadataTags.filter(
        (t) => t.uid !== existing.uid
      );
    }
    active.metadataTags.push({
      uid: `tag_custom_${generateCsprngToken()}`,
      id,
      category: cat,
      label,
      value: cleanValue,
      gpsCoordsRaw: id === "GPS:LOC" ? cleanValue : undefined,
      originalValue: "",
      privacy: false,
      edited: true,
      isCustom: true,
    });
    if (id === "GPS:LOC") syncRawGpsSubTags(active, cleanValue, true);
    active.hasEdits = true;
    invalidateCleanState(active);
  }

  if (
    state.categoryFilter !== "ALL" &&
    state.categoryFilter.toLowerCase() !== targetCat.toLowerCase()
  ) {
    state.categoryFilter = "ALL";
  }

  notify();
  showToast(
    `${existing && !existing.isCustom ? "Updated" : "Added"} ${label} (${id})`
  );
  return { ok: true, targetCat };
}
