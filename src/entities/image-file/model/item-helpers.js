import {
  escapeHtml,
  ORIENTATION_TAG_ID,
  safeFileBase,
  textEncoder,
} from "../../../shared/lib/index.js";

const isIccTag = (t) =>
  t.category === "Profile" ||
  t.id === "iCCP" ||
  t.id === "ICC" ||
  t.id === "ICCP";

export function revokeItemUrls(item) {
  if (!item) {
    return;
  }
  if (item.origPreviewUrl) {
    URL.revokeObjectURL(item.origPreviewUrl);
  }
  if (item.cleanUrl) {
    URL.revokeObjectURL(item.cleanUrl);
  }
  if (item.embeddedThumbUrl) {
    URL.revokeObjectURL(item.embeddedThumbUrl);
  }
}

export function computeLiveEstimatedSize(item) {
  if (!item) {
    return 0;
  }
  if (item.isCleaned) {
    return item.cleanedSize;
  }
  if (item.baseStrippedSize === item.originalSize) {
    return item.originalSize;
  }

  let removedIccBytes = 0;
  for (const t of item.metadataTags) {
    if (isIccTag(t) && item.selectedTagUids.has(t.uid)) {
      removedIccBytes += Number.parseInt(String(t.value || "0"), 10) || 0;
    }
  }
  const baseSize = Math.max(64, item.baseStrippedSize - removedIccBytes);
  const keptTags = item.metadataTags.filter(
    (t) =>
      !item.selectedTagUids.has(t.uid) &&
      t.id !== ORIENTATION_TAG_ID &&
      !isIccTag(t)
  );
  if (keptTags.length === 0) {
    return baseSize;
  }

  let extraBytes = 26;
  for (const t of keptTags) {
    if (t.id === "IFD1:THUMB") {
      extraBytes += (t.thumbBytesLength || 0) + 32;
    } else {
      const valLen = textEncoder.encode(String(t.value || "")).length + 1;
      extraBytes += 12 + (valLen > 4 ? valLen + (valLen % 2) : 0);
    }
  }
  return baseSize + extraBytes;
}

export function invalidateCleanState(item) {
  if (!item) {
    return;
  }
  item.isCleaned = false;
  item.verify = null;
  if (item.cleanUrl) {
    URL.revokeObjectURL(item.cleanUrl);
    item.cleanUrl = null;
  }
  item.cleanBlob = null;
  item.cleanCrc = undefined;
  item.cleanedSize = computeLiveEstimatedSize(item);
}

export function getOutputFileName(item) {
  const name = item.customBaseName?.trim()
    ? safeFileBase(item.customBaseName.trim())
    : "image_clean";
  return `${name}${item.ext || ".jpg"}`;
}

export function verifyBad(item) {
  return !!(item?.verify && (item.verify.failed || item.verify.count > 0));
}

export function verifyText(item) {
  const v = item.verify;
  if (!v) {
    return "Cleaned";
  }
  if (v.failed) {
    return "Cleaned (unverified)";
  }
  if (v.count > 0) {
    return `${v.count} ${v.count === 1 ? "field" : "fields"} remaining: ${v.remaining
      .slice(0, 3)
      .map((r) => r.label)
      .join(", ")}${v.count > 3 ? "…" : ""}`;
  }
  return "All metadata removed";
}

export function queueBadgeHtml(item) {
  if (!item.isCleaned) {
    return "";
  }
  const v = item.verify;
  if (!v) {
    return '<span class="meta-pill">✓ Cleaned</span>';
  }
  if (v.failed) {
    return '<span class="meta-pill" data-tooltip="Verification failed">? Unverified</span>';
  }
  if (v.count > 0) {
    return `<span class="meta-pill" data-tooltip="${escapeHtml(v.remaining.map((r) => r.label).join(", "))}">! ${v.count} left</span>`;
  }
  return '<span class="meta-pill">✓ Cleaned</span>';
}
