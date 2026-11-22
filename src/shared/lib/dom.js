export function escapeHtml(str) {
  return String(str)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control character sanitization
const UNSAFE_FILENAME_CHARS_RE = /[<>:"/\\|?*\x00-\x1f]+/g;
const RESERVED_DEVICE_NAMES_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

export function safeFileBase(raw) {
  let n = String(raw || "")
    .replace(UNSAFE_FILENAME_CHARS_RE, "_")
    .replace(/\.{2,}/gu, ".")
    .replace(/^[. ]+|[. ]+$/gu, "");
  if (RESERVED_DEVICE_NAMES_RE.test(n)) {
    n += "_";
  }
  return n.slice(0, 120) || "image_clean";
}

export async function copyTextSafe(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.className = "sr-only";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

export function scrollRowIntoTable(el) {
  const sc = el?.closest(".tbl-scroll");
  if (!sc) {
    return;
  }
  const er = el.getBoundingClientRect();
  const sr = sc.getBoundingClientRect();
  if (er.bottom > sr.bottom - 8) {
    sc.scrollTop += er.bottom - sr.bottom + 12;
  } else if (er.top < sr.top + 8) {
    sc.scrollTop -= sr.top - er.top + 12;
  }
}

export function triggerBlobDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
