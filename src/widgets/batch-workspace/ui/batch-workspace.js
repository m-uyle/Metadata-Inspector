import { getBatchItems, state } from "../../../entities/image-file/index.js";
import {
  GROUPS,
  groupOf,
  isLockedTag,
} from "../../../entities/metadata-tag/index.js";
import {
  applyRenameTemplate,
  computeRenameCandidate,
  setFieldAll,
  toggleBatchGroup,
  toggleBatchMaster,
} from "../../../features/batch-operations/index.js";
import {
  applyAllPendingFiles,
  downloadAllAsZip,
} from "../../../features/scrub-export/index.js";
import { escapeHtml, generateCsprngToken } from "../../../shared/lib/index.js";
import {
  badgeHtml,
  bindInputKeys,
  hideTooltip,
  ICONS,
  syncTriStateCheckbox,
  withButtonBusy,
} from "../../../shared/ui/index.js";

export function createBatchWorkspaceWidget() {
  const controller = new AbortController();
  const { signal } = controller;

  const el = document.createElement("div");
  el.id = "batchView";
  el.className = "hidden batch-view";
  el.innerHTML = `
    <div class="file-head">
      <div class="flex items-center gap-2 batch-head-title">
        <span class="t-title">Batch mode</span>
      </div>
      <div class="head-actions">
        <button id="btnBatchApplyAll" class="btn btn--subtle" type="button">
          <span id="btnBatchApplyAllText">Apply to all</span>
        </button>
        <button id="btnBatchDownloadZip" class="btn btn--subtle" type="button" aria-label="Download selected files as ZIP">
          ${ICONS.download}
          <span id="btnBatchDownloadZipText">Download .zip</span>
        </button>
      </div>
    </div>
    <div class="batch-scroll">
      <section class="batch-section" aria-label="Metadata across selected files">
        <div class="batch-section-head">
          <label class="sel-all">
            <input type="checkbox" id="batchMasterCheckbox" name="batchSelectAll" class="tag-chk" aria-label="Select all metadata across selected files for removal" />
            <span class="t-info">Metadata</span>
          </label>
          <span id="batchMetaSummary" class="state-pill"></span>
        </div>
        <div id="batchGroupsList" class="batch-groups"></div>
      </section>
      <details class="batch-section batch-collapsible" aria-label="Batch naming">
        <summary class="batch-section-toggle">
          <span class="batch-toggle-title">
            <span class="t-info">Naming</span>
            <span id="batchNamingStatus" class="batch-section-status">{name}_clean</span>
          </span>
          <span class="batch-toggle-chev" aria-hidden="true">${ICONS.chevronDown}</span>
        </summary>
        <div class="batch-collapsible-body">
          <div class="batch-presets">
            <button type="button" class="btn btn--subtle btn-sm batch-preset-btn" data-tpl="{name}_clean">Add _clean</button>
            <button type="button" class="btn btn--subtle btn-sm batch-preset-btn" data-tpl="{name}">Keep original</button>
            <button type="button" class="btn btn--subtle btn-sm batch-preset-btn" data-tpl="IMG_{n}">Numbered (001)</button>
            <button type="button" class="btn btn--subtle btn-sm batch-preset-btn" data-tpl="IMG_{rand}">Random</button>
          </div>
          <div class="batch-row-controls">
            <input type="text" id="batchRenameTpl" name="batchRenameTemplate" class="input flex-1" value="{name}_clean" spellcheck="false" aria-label="Name template" placeholder="{name}_clean" data-tooltip="Variables: {name}, {n}, {date}, {rand}" />
            <button id="btnApplyRename" class="btn btn--subtle" type="button">Apply names</button>
          </div>
          <div>
            <div id="batchRenamePreview" class="batch-preview-line" aria-label="Rename preview"></div>
          </div>
        </div>
      </details>
      <details class="batch-section batch-collapsible" aria-label="Set field for selected files">
        <summary class="batch-section-toggle">
          <span class="batch-toggle-title">
            <span class="t-info">Set field</span>
            <span id="batchFieldStatus" class="batch-section-status">Artist, Copyright, Software…</span>
          </span>
          <span class="batch-toggle-chev" aria-hidden="true">${ICONS.chevronDown}</span>
        </summary>
        <div class="batch-collapsible-body">
          <div class="batch-row-controls">
            <select id="batchFieldSelect" name="batchFieldSelect" class="hidden" aria-hidden="true" tabindex="-1">
              <option value="0x013B|Identity|Artist / Author">Artist / Author</option>
              <option value="0x8298|Identity|Copyright Notice">Copyright Notice</option>
              <option value="0x0131|Software|Software / Firmware">Software</option>
              <option value="0x010E|Description|Image Description">Description</option>
            </select>
            <div class="ui-dropdown ui-dropdown--md" data-dropdown="batchFieldSelect">
              <button type="button" class="ui-dropdown-btn" aria-haspopup="listbox" aria-expanded="false">
                <span class="ui-dropdown-label truncate">Artist / Author</span>
                ${ICONS.chevronDown}
              </button>
              <div class="ui-dropdown-menu" role="listbox"></div>
            </div>
            <input type="text" id="batchFieldValue" name="batchFieldValue" class="input flex-1" placeholder="Enter value" autocomplete="off" aria-label="Value to set on selected files" />
            <button id="btnApplyField" class="btn btn--subtle" type="button">Apply</button>
          </div>
        </div>
      </details>
    </div>
  `;

  const batchScrollEl = el.querySelector(".batch-scroll");
  const btnBatchApplyAll = el.querySelector("#btnBatchApplyAll");

  function syncBatchScrollFade() {
    if (!batchScrollEl) return;
    const maxScroll = batchScrollEl.scrollHeight - batchScrollEl.clientHeight;
    const hasScroll = maxScroll > 1;
    batchScrollEl.classList.toggle(
      "can-scroll-top",
      hasScroll && batchScrollEl.scrollTop > 2
    );
    batchScrollEl.classList.toggle(
      "can-scroll-bottom",
      hasScroll && batchScrollEl.scrollTop < maxScroll - 2
    );
  }
  const batchScrollObserver =
    typeof ResizeObserver === "function" && batchScrollEl
      ? new ResizeObserver(syncBatchScrollFade)
      : null;
  if (batchScrollObserver) batchScrollObserver.observe(batchScrollEl);
  if (batchScrollEl) {
    batchScrollEl.addEventListener("scroll", syncBatchScrollFade, {
      passive: true,
      signal,
    });
    batchScrollEl.addEventListener("toggle", syncBatchScrollFade, {
      capture: true,
      signal,
    });
  }
  const btnBatchApplyAllText = el.querySelector("#btnBatchApplyAllText");
  const btnBatchDownloadZip = el.querySelector("#btnBatchDownloadZip");
  const btnBatchDownloadZipText = el.querySelector("#btnBatchDownloadZipText");
  const batchMasterCheckbox = el.querySelector("#batchMasterCheckbox");
  const batchMetaSummary = el.querySelector("#batchMetaSummary");
  const batchGroupsList = el.querySelector("#batchGroupsList");
  const batchNamingStatus = el.querySelector("#batchNamingStatus");
  const batchFieldStatus = el.querySelector("#batchFieldStatus");
  const batchRenameTpl = el.querySelector("#batchRenameTpl");
  const batchRenamePreview = el.querySelector("#batchRenamePreview");
  const btnApplyRename = el.querySelector("#btnApplyRename");
  const batchFieldSelect = el.querySelector("#batchFieldSelect");
  const batchFieldValue = el.querySelector("#batchFieldValue");
  const btnApplyField = el.querySelector("#btnApplyField");

  batchMasterCheckbox.addEventListener(
    "change",
    (e) => {
      toggleBatchMaster(e.target.checked);
    },
    { signal }
  );

  batchGroupsList.addEventListener(
    "change",
    (e) => {
      const chk = e.target.closest("[data-batch-group]");
      if (!chk) return;
      toggleBatchGroup(chk.getAttribute("data-batch-group"), chk.checked);
    },
    { signal }
  );

  el.querySelectorAll(".batch-preset-btn").forEach((btn) => {
    btn.addEventListener(
      "click",
      () => {
        state.previewRandToken = generateCsprngToken()
          .slice(0, 6)
          .toUpperCase();
        batchRenameTpl.value = btn.getAttribute("data-tpl");
        applyRenameTemplate(batchRenameTpl.value);
      },
      { signal }
    );
  });

  batchRenameTpl.addEventListener("input", () => render(), { signal });
  bindInputKeys(
    batchRenameTpl,
    { onEnter: () => applyRenameTemplate(batchRenameTpl.value) },
    signal
  );
  btnApplyRename.addEventListener(
    "click",
    () => {
      applyRenameTemplate(batchRenameTpl.value);
    },
    { signal }
  );

  function syncFieldStatus() {
    const val = batchFieldValue.value.trim();
    const label =
      batchFieldSelect.options[batchFieldSelect.selectedIndex]?.textContent ||
      "Field";
    batchFieldStatus.textContent = val
      ? `${label}: ${val}`
      : "Artist, Copyright, Software…";
  }

  batchFieldValue.addEventListener("input", syncFieldStatus, { signal });
  batchFieldSelect.addEventListener("change", syncFieldStatus, { signal });

  bindInputKeys(
    batchFieldValue,
    { onEnter: () => btnApplyField.click() },
    signal
  );
  btnApplyField.addEventListener(
    "click",
    () => {
      setFieldAll(batchFieldSelect.value, batchFieldValue.value);
    },
    { signal }
  );

  btnBatchApplyAll.addEventListener(
    "click",
    async () => {
      hideTooltip();
      btnBatchApplyAll.disabled = true;
      await applyAllPendingFiles();
    },
    { signal }
  );

  btnBatchDownloadZip.addEventListener(
    "click",
    () =>
      withButtonBusy(btnBatchDownloadZip, () => downloadAllAsZip(), {
        isDisabledAfter: () => getBatchItems().length === 0,
      }),
    { signal }
  );

  function hide() {
    el.classList.add("hidden");
  }

  function render() {
    el.classList.remove("hidden");

    const targets = getBatchItems();
    let totalRemovable = 0;
    let totalSelected = 0;
    let uncleanedCount = 0;

    for (const item of targets) {
      if (!item.isCleaned) uncleanedCount++;
      const rem = item.metadataTags.filter((t) => !isLockedTag(t));
      totalRemovable += rem.length;
      totalSelected += rem.filter((t) =>
        item.selectedTagUids.has(t.uid)
      ).length;
    }
    btnBatchApplyAll.disabled = uncleanedCount === 0;
    btnBatchApplyAll.classList.toggle("btn-primary", uncleanedCount > 0);
    btnBatchDownloadZip.classList.toggle("btn-primary", uncleanedCount === 0);
    btnBatchDownloadZipText.textContent = `Download .zip (${targets.length})`;
    const anyPendingEdits = targets.some(
      (i) => !i.isCleaned && i.metadataTags.some((t) => t.edited || t.isCustom)
    );
    btnBatchApplyAllText.textContent =
      uncleanedCount === 0
        ? "Done"
        : anyPendingEdits
          ? `Apply to all (${uncleanedCount})`
          : totalSelected > 0
            ? `Remove all (${uncleanedCount})`
            : `Save all (${uncleanedCount})`;

    syncTriStateCheckbox(batchMasterCheckbox, totalSelected, totalRemovable);
    batchMetaSummary.textContent =
      totalRemovable === 0
        ? "No metadata to remove"
        : `${totalSelected} of ${totalRemovable} to remove`;

    batchGroupsList.innerHTML = "";
    let anyGroup = false;
    for (const g of GROUPS) {
      let gTotal = 0;
      let gSel = 0;
      let gFiles = 0;
      for (const item of targets) {
        const members = item.metadataTags.filter(
          (t) => groupOf(t) === g.key && !isLockedTag(t)
        );
        if (members.length) gFiles++;
        gTotal += members.length;
        gSel += members.filter((t) => item.selectedTagUids.has(t.uid)).length;
      }
      if (gTotal === 0) continue;
      anyGroup = true;
      const row = document.createElement("label");
      row.className = "batch-group-row";
      row.innerHTML = `
        <span class="inline-flex items-center gap-3">
          <input type="checkbox" name="batchGroup_${g.key}" class="tag-chk" data-batch-group="${g.key}" aria-label="Toggle ${g.title} across selected files" />
          <span class="t-info">${g.title}</span>
          <span class="batch-group-files">${gFiles} ${gFiles === 1 ? "file" : "files"}</span>
        </span>
        ${badgeHtml(`Remove ${gSel}/${gTotal}`, "pill")}
      `;
      syncTriStateCheckbox(row.querySelector("input"), gSel, gTotal);
      batchGroupsList.appendChild(row);
    }
    if (!anyGroup) {
      batchGroupsList.innerHTML =
        '<div class="t-sub batch-groups-empty">No metadata to remove.</div>';
    }

    const tpl = batchRenameTpl.value || "{name}_clean";
    batchNamingStatus.textContent = tpl;
    syncFieldStatus();
    el.querySelectorAll(".batch-preset-btn").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-tpl") === tpl);
    });
    const first = targets[0];
    if (first) {
      const previewBase = computeRenameCandidate(first, tpl, 1);
      const afterName = `${previewBase}${first.ext || ""}`;
      batchRenamePreview.innerHTML = `<span class="badge batch-preview-pill truncate">${escapeHtml(first.name)}</span><span class="batch-preview-arrow" aria-hidden="true">→</span><span class="badge batch-preview-pill batch-preview-pill--after truncate">${escapeHtml(afterName)}</span>`;
    }
    syncBatchScrollFade();
  }

  function destroy() {
    if (batchScrollObserver) batchScrollObserver.disconnect();
    controller.abort();
    el.remove();
  }

  return { el, render, hide, destroy };
}
