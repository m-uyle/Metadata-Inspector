import {
  computeLiveEstimatedSize,
  notify,
  queueBadgeHtml,
  state,
} from "../../../entities/image-file/index.js";
import {
  clearQueue,
  dismissFailed,
  removeItem,
} from "../../../features/import-files/index.js";
import { escapeHtml, formatBytes } from "../../../shared/lib/index.js";
import {
  badgeHtml,
  closeAllDropdowns,
  createCheckbox,
  hideTooltip,
  ICONS,
} from "../../../shared/ui/index.js";

export function createFileQueueWidget({ onAddFilesClick, askConfirm }) {
  const controller = new AbortController();
  const { signal } = controller;

  const el = document.createElement("aside");
  el.className = "sidebar";
  el.setAttribute("aria-label", "Files");
  el.innerHTML = `
    <div class="side-top">
      <button id="dropZoneBtn" class="btn side-add" type="button" aria-label="Add files">
        ${ICONS.plus}
        <span>Add files</span>
      </button>
    </div>
    <div id="queueBar" class="queue-bar hidden" role="toolbar" aria-label="Queue controls">
      <div id="queueSelectionActions" class="queue-bar-left hidden" role="group" aria-label="Queue selection">
        <button id="btnSelectAllQueue" class="btn queue-mini-btn" type="button">All</button>
        <button id="btnSelectNoneQueue" class="btn queue-mini-btn" type="button">None</button>
      </div>
      <span id="queueFileCount" class="queue-bar-count"></span>
      <div class="queue-bar-right">
        <button
          id="btnClearAll"
          class="btn btn--danger queue-mini-btn"
          type="button"
          disabled
          aria-label="Clear queue"
        >
          <span>Clear</span>
        </button>
      </div>
    </div>
    <div id="fileListContainer" class="queue">
      <div id="emptyQueueHint" class="queue-empty">No files in queue</div>
    </div>
    <div class="side-credit">by uyle</div>
  `;

  const dropZoneBtn = el.querySelector("#dropZoneBtn");
  const queueBar = el.querySelector("#queueBar");
  const btnClearAll = el.querySelector("#btnClearAll");
  const queueFileCount = el.querySelector("#queueFileCount");
  const queueSelectionActions = el.querySelector("#queueSelectionActions");
  const btnSelectAllQueue = el.querySelector("#btnSelectAllQueue");
  const btnSelectNoneQueue = el.querySelector("#btnSelectNoneQueue");
  const fileListContainer = el.querySelector("#fileListContainer");
  const emptyQueueHint = el.querySelector("#emptyQueueHint");

  const queueRowCache = new Map();
  let scrollRafId = null;

  function syncQueueScrollState() {
    const maxScroll =
      fileListContainer.scrollHeight - fileListContainer.clientHeight;
    const hasScroll = maxScroll > 1;
    fileListContainer.classList.toggle("has-scroll", hasScroll);
    fileListContainer.classList.toggle(
      "can-scroll-top",
      hasScroll && fileListContainer.scrollTop > 2
    );
    fileListContainer.classList.toggle(
      "can-scroll-bottom",
      hasScroll && fileListContainer.scrollTop < maxScroll - 2
    );
  }

  function scheduleScrollSync() {
    if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      syncQueueScrollState();
    });
  }

  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(syncQueueScrollState)
      : null;
  if (resizeObserver) resizeObserver.observe(fileListContainer);
  fileListContainer.addEventListener("scroll", syncQueueScrollState, {
    passive: true,
    signal,
  });

  dropZoneBtn.addEventListener("click", () => onAddFilesClick(), { signal });

  btnSelectAllQueue.addEventListener(
    "click",
    () => {
      if (state.items.length === 0) return;
      hideTooltip();
      closeAllDropdowns();
      state.editingTagUid = null;
      state.checkedIds = new Set(state.items.map((i) => i.id));
      state.batchMode = state.checkedIds.size > 1;
      notify(["checkedIds", "batchMode", "editingTagUid"]);
    },
    { signal }
  );

  btnSelectNoneQueue.addEventListener(
    "click",
    () => {
      if (state.checkedIds.size === 0 && !state.batchMode) return;
      hideTooltip();
      closeAllDropdowns();
      state.editingTagUid = null;
      state.checkedIds.clear();
      state.batchMode = false;
      notify(["checkedIds", "batchMode", "editingTagUid"]);
    },
    { signal }
  );

  btnClearAll.addEventListener(
    "click",
    async () => {
      hideTooltip();
      await clearQueue(askConfirm);
    },
    { signal }
  );

  fileListContainer.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (img?.classList?.contains("thumb-img")) {
        const fallbackUrl = img.getAttribute("data-fallback-src");
        if (fallbackUrl && img.getAttribute("src") !== fallbackUrl) {
          img.setAttribute("src", fallbackUrl);
          return;
        }
        const box = img.closest(".thumb-box");
        const fmt = img.getAttribute("data-format") || "IMG";
        img.classList.add("hidden");
        if (box && !box.querySelector(".thumb-fmt-lbl")) {
          const sp = document.createElement("span");
          sp.className = "t-sub thumb-fmt-lbl";
          sp.textContent = fmt;
          box.appendChild(sp);
        }
      }
    },
    { capture: true, signal }
  );

  function buildRow(
    item,
    isSelected,
    isChecked,
    showCheckbox,
    projectedAfterSize
  ) {
    const row = document.createElement("div");
    row.className = `queue-item${isSelected ? " active" : ""}${isChecked ? " checked" : ""}`;
    row.setAttribute("role", "listitem");
    row.setAttribute("tabindex", "0");
    row.setAttribute(
      "aria-label",
      `${item.name}, ${item.isCleaned ? "Cleaned" : "Not cleaned"}`
    );
    const thumbSrc = item.isCleaned
      ? item.cleanUrl
      : item.origPreviewUrl || item.embeddedThumbUrl;
    const diff = item.originalSize - projectedAfterSize;
    const isInPlaceContainer =
      item.baseStrippedSize === item.originalSize &&
      item.metadataTags.length > 0;
    let sizeLabelStr;
    if (isInPlaceContainer && diff === 0) {
      sizeLabelStr = item.isCleaned
        ? `${formatBytes(item.originalSize)} (cleaned)`
        : `${formatBytes(item.originalSize)} (${item.selectedTagUids.size} to remove)`;
    } else {
      const afterStr = item.isCleaned
        ? formatBytes(projectedAfterSize)
        : `~${formatBytes(projectedAfterSize)}`;
      const diffStr =
        diff === 0
          ? ""
          : ` (${diff > 0 ? `-${formatBytes(diff)}` : `+${formatBytes(Math.abs(diff))}`})`;
      sizeLabelStr = `${formatBytes(item.originalSize)} → ${afterStr}${diffStr}`;
    }

    row.innerHTML = `
      <div class="queue-item-head">
        <div class="queue-item-main">
          <div class="thumb-box thumb-sm" aria-hidden="true">
            <img src="${escapeHtml(thumbSrc || "")}" data-fallback-src="${escapeHtml(item.embeddedThumbUrl || "")}" data-format="${escapeHtml(item.format)}" alt="" class="thumb-img" loading="lazy" decoding="async">
          </div>
          <div class="queue-item-titles">
            <span class="t-info truncate" data-tooltip-overflow="${escapeHtml((item.customBaseName || "image_clean") + (item.ext || ""))}">${escapeHtml(item.customBaseName || "image_clean")}</span>
            <div class="queue-item-tags">
              ${badgeHtml(item.format, "pill")}
              ${badgeHtml(sizeLabelStr, "pill")}
              ${queueBadgeHtml(item)}
            </div>
          </div>
        </div>
        <button data-remove="${escapeHtml(item.id)}" class="btn btn--ghost icon-btn btn-xs queue-item-remove" type="button" data-tooltip="Remove" aria-label="Remove ${escapeHtml(item.name)} from list">${ICONS.closeXs}</button>
      </div>
    `;

    if (showCheckbox) {
      const mainEl = row.querySelector(".queue-item-main");
      const chk = createCheckbox({
        name: `queueSelect_${item.id}`,
        checked: isChecked,
        className: "queue-item-chk",
        ariaLabel: `Select ${item.name} for batch mode`,
        tooltip: "Select 2 or more files for batch mode",
        tooltipDelay: 700,
        onChange: (e) => {
          hideTooltip();
          closeAllDropdowns();
          if (e.target.checked) state.checkedIds.add(item.id);
          else state.checkedIds.delete(item.id);
          state.editingTagUid = null;
          state.batchMode = state.checkedIds.size > 1;
          if (!state.batchMode && state.checkedIds.size === 1) {
            state.selectedId = [...state.checkedIds][0];
          }
          notify(["checkedIds", "batchMode", "selectedId", "editingTagUid"]);
        },
        signal,
      });
      chk.addEventListener("click", (e) => e.stopPropagation(), { signal });
      mainEl.prepend(chk);
    }

    row.addEventListener(
      "click",
      (e) => {
        const rmBtn = e.target.closest("[data-remove]");
        if (rmBtn) {
          hideTooltip();
          removeItem(rmBtn.getAttribute("data-remove"));
          return;
        }
        if (e.target.closest(".queue-item-chk")) return;
        closeAllDropdowns();
        state.editingTagUid = null;
        state.checkedIds.clear();
        state.batchMode = false;
        state.selectedId = item.id;
        notify(["selectedId", "checkedIds", "batchMode", "editingTagUid"]);
      },
      { signal }
    );

    row.addEventListener(
      "keydown",
      (e) => {
        if (e.target.closest("button, input")) return;
        if (e.key === " " && state.batchMode) {
          e.preventDefault();
          const chk = row.querySelector(".queue-item-chk");
          if (chk) chk.click();
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          state.editingTagUid = null;
          state.checkedIds.clear();
          state.batchMode = false;
          state.selectedId = item.id;
          notify(["selectedId", "checkedIds", "batchMode", "editingTagUid"]);
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const idx = state.items.findIndex((x) => x.id === item.id);
          if (idx === -1) return;
          const nextIdx =
            e.key === "ArrowDown"
              ? Math.min(state.items.length - 1, idx + 1)
              : Math.max(0, idx - 1);
          if (nextIdx !== idx) {
            if (state.batchMode) {
              const rows = fileListContainer.querySelectorAll(
                '.queue-item[tabindex="0"]'
              );
              if (rows[nextIdx]) rows[nextIdx].focus();
            } else {
              state.editingTagUid = null;
              state.checkedIds.clear();
              state.batchMode = false;
              state.selectedId = state.items[nextIdx].id;
              notify([
                "selectedId",
                "checkedIds",
                "batchMode",
                "editingTagUid",
              ]);
              const rows = fileListContainer.querySelectorAll(
                '.queue-item[tabindex="0"]'
              );
              if (rows[nextIdx]) rows[nextIdx].focus();
            }
          }
        }
      },
      { signal }
    );

    return row;
  }

  function render() {
    const totalVisible = state.items.length + state.failed.length;
    if (totalVisible > 0) {
      fileListContainer.setAttribute("role", "list");
      fileListContainer.setAttribute("aria-label", "File queue");
    } else {
      fileListContainer.removeAttribute("role");
      fileListContainer.removeAttribute("aria-label");
    }

    queueBar.classList.toggle("hidden", totalVisible === 0);
    btnClearAll.disabled = totalVisible === 0;

    const checkedCount = state.checkedIds.size;
    if (state.items.length > 0) {
      queueFileCount.textContent =
        checkedCount > 0
          ? `${checkedCount} / ${state.items.length} selected`
          : `${state.items.length} ${state.items.length === 1 ? "file" : "files"}`;
    } else if (state.failed.length > 0) {
      queueFileCount.textContent = `${state.failed.length} skipped`;
    } else {
      queueFileCount.textContent = "";
    }

    const showSelection = state.items.length > 1;
    queueBar.classList.toggle("queue-bar--single", !showSelection);
    queueSelectionActions.classList.toggle("hidden", !showSelection);
    if (showSelection) {
      btnSelectAllQueue.disabled = checkedCount === state.items.length;
      btnSelectNoneQueue.disabled = checkedCount === 0;
    }

    for (const ch of Array.from(fileListContainer.children)) {
      if (ch.id !== "emptyQueueHint") ch.remove();
    }

    for (const f of state.failed) {
      const fr = document.createElement("div");
      fr.className = "queue-item queue-item-failed";
      fr.setAttribute("role", "listitem");
      fr.innerHTML = `<div class="queue-item-head"><div class="queue-item-main"><div class="thumb-box thumb-sm" aria-hidden="true"><span class="t-sub">!</span></div><div class="queue-item-titles"><span class="t-info truncate" data-tooltip-overflow="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span><div class="queue-item-tags">${badgeHtml("Skipped", "pill")}${badgeHtml(f.reason, "pill", "truncate")}</div></div></div><button class="btn btn--ghost icon-btn btn-xs queue-item-remove" type="button" data-tooltip="Dismiss" aria-label="Dismiss error for ${escapeHtml(f.name)}">${ICONS.closeXs}</button></div>`;
      fr.querySelector("button").addEventListener(
        "click",
        () => {
          dismissFailed(f.id);
        },
        { signal }
      );
      fileListContainer.appendChild(fr);
    }

    if (state.items.length === 0) {
      emptyQueueHint.classList.toggle("hidden", state.failed.length > 0);
      scheduleScrollSync();
      return;
    }
    emptyQueueHint.classList.add("hidden");

    const showCheckbox = state.items.length > 1;
    const live = new Set();
    const frag = document.createDocumentFragment();
    for (const item of state.items) {
      const isChecked = showCheckbox && state.checkedIds.has(item.id);
      const isSelected = !state.batchMode && item.id === state.selectedId;
      const src = item.isCleaned
        ? item.cleanUrl
        : item.origPreviewUrl || item.embeddedThumbUrl;
      const projectedAfterSize = item.isCleaned
        ? item.cleanedSize
        : computeLiveEstimatedSize(item);
      const sig = [
        item.id,
        item.name,
        item.customBaseName,
        item.ext,
        item.format,
        item.dimensions,
        item.isCleaned ? 1 : 0,
        item.originalSize,
        projectedAfterSize,
        item.selectedTagUids.size,
        isSelected ? 1 : 0,
        isChecked ? 1 : 0,
        showCheckbox ? 1 : 0,
        src,
        item.verify
          ? `${item.verify.count}:${item.verify.failed ? 1 : 0}`
          : "-",
      ].join("|");
      let c = queueRowCache.get(item.id);
      if (!c || c.sig !== sig) {
        c = {
          sig,
          el: buildRow(
            item,
            isSelected,
            isChecked,
            showCheckbox,
            projectedAfterSize
          ),
        };
        queueRowCache.set(item.id, c);
      }
      live.add(item.id);
      frag.appendChild(c.el);
    }
    for (const id of Array.from(queueRowCache.keys())) {
      if (!live.has(id)) queueRowCache.delete(id);
    }
    fileListContainer.appendChild(frag);
    scheduleScrollSync();
  }

  function destroy() {
    if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
    if (resizeObserver) resizeObserver.disconnect();
    controller.abort();
    queueRowCache.clear();
    el.remove();
  }

  return { el, render, destroy };
}
