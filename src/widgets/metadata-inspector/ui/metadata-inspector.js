import {
  getActiveItem,
  state,
  verifyBad,
  verifyText,
} from "../../../entities/image-file/index.js";
import {
  GROUPS,
  groupOf,
  isEditableTag,
  isGpsRaw,
  isLockedTag,
  isProfileTag,
  sortForDisplay,
} from "../../../entities/metadata-tag/index.js";
import {
  applyEditsToAllQueue,
  deleteTag,
  removeAllGpsOnActive,
  resetActiveFile,
  resetTagValue,
  saveInlineEdit,
  toggleGroupSelection,
  toggleMasterSelection,
  toggleTagSelection,
} from "../../../features/edit-metadata/index.js";
import {
  applyActiveFile,
  downloadActiveFile,
  downloadAllAsZip,
} from "../../../features/scrub-export/index.js";
import {
  copyTextSafe,
  escapeHtml,
  generateCsprngToken,
  safeFileBase,
  scrollRowIntoTable,
} from "../../../shared/lib/index.js";
import {
  badgeHtml,
  clearInputError,
  closeAllDropdowns,
  hideTooltip,
  ICONS,
  setInputError,
  showToast,
  syncAllDropdowns,
  syncTriStateCheckbox,
  withButtonBusy,
} from "../../../shared/ui/index.js";

export function createMetadataInspectorWidget({
  onAddFilesClick,
  onOpenAddTag,
  onOpenThumbPreview,
  onQueueNameChanged,
}) {
  const controller = new AbortController();
  const { signal } = controller;

  const fragment = document.createDocumentFragment();

  const emptyEl = document.createElement("div");
  emptyEl.id = "fileHeaderEmpty";
  emptyEl.className = "empty";
  emptyEl.innerHTML = `
    <div class="empty-copy">
      <span class="t-title">Drop images here</span>
      <span class="t-sub empty-formats">JPEG, PNG, WebP, GIF, HEIC, AVIF, RAW</span>
    </div>
  `;

  const headerEl = document.createElement("div");
  headerEl.id = "fileHeaderContent";
  headerEl.className = "hidden file-head";
  headerEl.innerHTML = `
    <div class="name-row">
      <div class="input-group">
        <label for="inputCustomName" class="hidden">Output filename</label>
        <input type="text" id="inputCustomName" name="customFilename" class="input-group-inner" placeholder="Filename" spellcheck="false" aria-label="Output filename" />
        <span id="inspectExtBadge" class="hud-ext-tag">.jpg</span>
      </div>
      <button id="btnGenerateCsprng" class="btn btn--subtle icon-btn" type="button" data-tooltip="Randomize filename" aria-label="Random filename">
        ${ICONS.shuffle}
      </button>
    </div>
    <div class="head-actions">
      <button id="btnApplyCurrent" class="btn btn--subtle" type="button" disabled >
        <span id="btnApplyCurrentText">Apply</span>
      </button>
      <button id="btnDownloadCurrent" class="btn btn--subtle btn-primary" type="button" disabled data-tooltip-disabled="Apply changes first">
        ${ICONS.download}
        <span id="btnDownloadCurrentText">Download</span>
      </button>
      <button id="btnDownloadZipHeader" class="btn btn--subtle btn--compact hidden" type="button" data-tooltip="Download all as .zip" aria-label="Download all files as ZIP">
        <span>ZIP</span>
      </button>
    </div>
  `;

  const wrapEl = document.createElement("div");
  wrapEl.id = "metaSectionWrapper";
  wrapEl.className = "hidden meta-wrap";
  wrapEl.innerHTML = `
    <div class="table-toolbar" role="toolbar" aria-label="Metadata actions">
      <label class="sel-all">
        <input type="checkbox" id="masterCheckbox" name="selectAllMetadata" class="tag-chk" aria-label="Select all fields for removal" />
        <span id="inspectStateBadge" class="state-pill" aria-live="polite"></span>
      </label>
      <span class="grow"></span>
      <div class="toolbar-actions">
        <select id="categoryFilterSelect" name="categoryFilter" class="hidden" aria-hidden="true" tabindex="-1">
          <option value="ALL">All categories</option>
          <option value="Geolocation">Geolocation</option>
          <option value="Preview">Preview</option>
          <option value="Identity">Identity</option>
          <option value="Description">Description</option>
          <option value="Hardware">Hardware</option>
          <option value="Environment">Environment</option>
          <option value="Timestamp">Timestamp</option>
          <option value="Software">Software</option>
          <option value="Optics">Optics</option>
          <option value="Profile">Profile</option>
          <option value="Metadata">Metadata</option>
          <option value="Custom">Custom</option>
        </select>
        <div class="ui-dropdown ui-dropdown-sm" data-dropdown="categoryFilterSelect">
          <button type="button" class="ui-dropdown-btn" aria-haspopup="listbox" aria-expanded="false">
            <span class="ui-dropdown-label truncate">All categories</span>
            ${ICONS.chevronDown}
          </button>
          <div class="ui-dropdown-menu" role="listbox"></div>
        </div>
        <button id="btnResetFile" class="btn btn--ghost btn-sm hidden" type="button">Reset</button>
        <button id="btnApplyEditsToAll" class="btn btn--subtle btn-sm hidden" type="button">Copy to all</button>
        <button id="btnOpenAddTag" class="btn btn--subtle btn-sm" type="button">+ Add</button>
      </div>
    </div>
    <div class="tbl-scroll">
      <table aria-label="Extracted metadata"><tbody id="metadataTableBody"></tbody></table>
    </div>
  `;

  fragment.append(emptyEl, headerEl, wrapEl);

  const expandedGpsRawFiles = new Set();
  const headActions = headerEl.querySelector(".head-actions");
  const toolbarActions = wrapEl.querySelector(".toolbar-actions");

  function syncToolbarActionsWidth() {
    const w = Math.round(headActions.getBoundingClientRect().width);
    if (w > 0) {
      toolbarActions.style.setProperty("--head-actions-w", `${w}px`);
    }
  }

  const headActionsObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(syncToolbarActionsWidth)
      : null;
  if (headActionsObserver) headActionsObserver.observe(headActions);
  const inputCustomName = headerEl.querySelector("#inputCustomName");
  const inspectExtBadge = headerEl.querySelector("#inspectExtBadge");
  const btnGenerateCsprng = headerEl.querySelector("#btnGenerateCsprng");
  const btnApplyCurrent = headerEl.querySelector("#btnApplyCurrent");
  const btnApplyCurrentText = headerEl.querySelector("#btnApplyCurrentText");
  const btnDownloadCurrent = headerEl.querySelector("#btnDownloadCurrent");
  const btnDownloadCurrentText = headerEl.querySelector(
    "#btnDownloadCurrentText"
  );
  const btnDownloadZipHeader = headerEl.querySelector("#btnDownloadZipHeader");
  const masterCheckbox = wrapEl.querySelector("#masterCheckbox");
  const inspectStateBadge = wrapEl.querySelector("#inspectStateBadge");
  const categoryFilterSelect = wrapEl.querySelector("#categoryFilterSelect");
  const btnResetFile = wrapEl.querySelector("#btnResetFile");
  const btnApplyEditsToAll = wrapEl.querySelector("#btnApplyEditsToAll");
  const btnOpenAddTag = wrapEl.querySelector("#btnOpenAddTag");
  const tblScrollEl = wrapEl.querySelector(".tbl-scroll");
  const metadataTableBody = wrapEl.querySelector("#metadataTableBody");

  function syncTableScrollFade() {
    if (!tblScrollEl) return;
    const maxScroll = tblScrollEl.scrollHeight - tblScrollEl.clientHeight;
    const hasScroll = maxScroll > 1;
    tblScrollEl.classList.toggle(
      "can-scroll-top",
      hasScroll && tblScrollEl.scrollTop > 2
    );
    tblScrollEl.classList.toggle(
      "can-scroll-bottom",
      hasScroll && tblScrollEl.scrollTop < maxScroll - 2
    );
  }
  const tblScrollObserver =
    typeof ResizeObserver === "function" && tblScrollEl
      ? new ResizeObserver(syncTableScrollFade)
      : null;
  if (tblScrollObserver) tblScrollObserver.observe(tblScrollEl);
  if (tblScrollEl) {
    tblScrollEl.addEventListener("scroll", syncTableScrollFade, {
      passive: true,
      signal,
    });
  }

  if (onAddFilesClick) {
    emptyEl.setAttribute("role", "button");
    emptyEl.setAttribute("tabindex", "0");
    emptyEl.setAttribute("aria-label", "Choose images to inspect");
    emptyEl.addEventListener("click", () => onAddFilesClick(), { signal });
    emptyEl.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAddFilesClick();
        }
      },
      { signal }
    );
  }

  inputCustomName.addEventListener(
    "input",
    (e) => {
      const active = getActiveItem();
      if (!active) return;
      active.customBaseName = e.target.value.replace(/[<>:"/\\|?*]+/g, "");
      onQueueNameChanged();
    },
    { signal }
  );

  let committedCustomName = "";
  inputCustomName.addEventListener(
    "focus",
    () => {
      committedCustomName = inputCustomName.value;
    },
    { signal }
  );
  inputCustomName.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        inputCustomName.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        const active = getActiveItem();
        if (active) {
          active.customBaseName = committedCustomName || active.customBaseName;
          inputCustomName.value = active.customBaseName;
          onQueueNameChanged();
        }
        inputCustomName.blur();
      }
    },
    { signal }
  );
  inputCustomName.addEventListener(
    "blur",
    (e) => {
      const active = getActiveItem();
      if (!active) return;
      let val = active.customBaseName.trim();
      if (active.ext && val.toLowerCase().endsWith(active.ext.toLowerCase())) {
        val = val.slice(0, -active.ext.length).trim();
      }
      active.customBaseName = safeFileBase(val || "image_clean");
      e.target.value = active.customBaseName;
      onQueueNameChanged();
    },
    { signal }
  );

  btnGenerateCsprng.addEventListener(
    "click",
    () => {
      const active = getActiveItem();
      if (!active) return;
      active.customBaseName = `IMG_${generateCsprngToken().toUpperCase()}`;
      inputCustomName.value = active.customBaseName;
      onQueueNameChanged();
      showToast("Filename randomized");
    },
    { signal }
  );

  function getPrimaryActionLabels(item) {
    if (!item) return { idle: "Remove", busy: "Removing…" };
    const hasEdits = item.metadataTags.some((t) => t.edited || t.isCustom);
    const hasRemovals = item.selectedTagUids.size > 0;
    if (hasEdits) return { idle: "Apply", busy: "Applying…" };
    if (hasRemovals) return { idle: "Remove", busy: "Removing…" };
    return { idle: "Save", busy: "Saving…" };
  }

  btnApplyCurrent.addEventListener(
    "click",
    async () => {
      const active = getActiveItem();
      if (!active || active.isCleaned) return;
      hideTooltip();
      const labels = getPrimaryActionLabels(active);
      btnApplyCurrent.disabled = true;
      btnApplyCurrentText.textContent = labels.busy;
      try {
        await applyActiveFile();
      } catch (err) {
        btnApplyCurrentText.textContent = labels.idle;
        btnApplyCurrent.disabled = false;
        showToast(`Failed: ${err?.message ? err.message : "error"}`);
      }
    },
    { signal }
  );

  btnDownloadCurrent.addEventListener(
    "click",
    () => {
      downloadActiveFile();
    },
    { signal }
  );

  btnDownloadZipHeader.addEventListener(
    "click",
    () => {
      hideTooltip();
      return withButtonBusy(
        btnDownloadZipHeader,
        () => downloadAllAsZip(state.items),
        { isDisabledAfter: () => state.items.length < 2 }
      );
    },
    { signal }
  );

  masterCheckbox.addEventListener(
    "change",
    (e) => {
      toggleMasterSelection(e.target.checked);
    },
    { signal }
  );

  categoryFilterSelect.addEventListener(
    "change",
    (e) => {
      state.editingTagUid = null;
      state.categoryFilter = e.target.value;
      render();
      syncAllDropdowns();
    },
    { signal }
  );

  btnResetFile.addEventListener(
    "click",
    () => {
      resetActiveFile();
    },
    { signal }
  );

  btnApplyEditsToAll.addEventListener(
    "click",
    () => {
      applyEditsToAllQueue();
    },
    { signal }
  );

  btnOpenAddTag.addEventListener(
    "click",
    () => {
      onOpenAddTag();
    },
    { signal }
  );

  function readEditorValue() {
    const lat = metadataTableBody.querySelector("#inlineGpsLat");
    if (lat) {
      const lon = metadataTableBody.querySelector("#inlineGpsLon");
      return `${lat.value.trim()}, ${lon ? lon.value.trim() : ""}`;
    }
    const i = metadataTableBody.querySelector("#inlineEditVal");
    return i ? i.value : "";
  }

  function commitInlineEdit(tagUid, value) {
    const res = saveInlineEdit(tagUid, value);
    if (!res.ok) {
      const errEl = metadataTableBody.querySelector("#inlineEditErr");
      const fld =
        metadataTableBody.querySelector("#inlineEditVal") ||
        metadataTableBody.querySelector("#inlineGpsLat");
      setInputError(fld, errEl, res.error);
      if (errEl) scrollRowIntoTable(errEl.closest("tr") || errEl);
    }
  }

  function cancelInlineEdit(restoreUid) {
    state.editingTagUid = null;
    render();
    syncAllDropdowns();
    if (restoreUid) {
      const btn = metadataTableBody.querySelector(
        `[data-edit-tag="${CSS.escape(restoreUid)}"]`
      );
      if (btn) btn.focus();
    }
  }

  metadataTableBody.addEventListener(
    "click",
    (e) => {
      const viewThumbBtn = e.target.closest("[data-view-thumb]");
      if (viewThumbBtn) {
        onOpenThumbPreview(
          viewThumbBtn.getAttribute("data-view-thumb"),
          Number.parseInt(
            viewThumbBtn.getAttribute("data-thumb-size") || "0",
            10
          )
        );
        return;
      }

      const expandBtn = e.target.closest("[data-toggle-expand]");
      if (expandBtn) {
        const uid = expandBtn.getAttribute("data-toggle-expand");
        if (state.expandedTagUids.has(uid)) state.expandedTagUids.delete(uid);
        else state.expandedTagUids.add(uid);
        render();
        syncAllDropdowns();
        return;
      }

      const toggleGpsRawBtn = e.target.closest("[data-toggle-gps-raw]");
      if (toggleGpsRawBtn) {
        const fileId = toggleGpsRawBtn.getAttribute("data-toggle-gps-raw");
        if (expandedGpsRawFiles.has(fileId)) expandedGpsRawFiles.delete(fileId);
        else expandedGpsRawFiles.add(fileId);
        render();
        syncAllDropdowns();
        return;
      }

      const copyGpsBtn = e.target.closest("[data-copy-gps]");
      if (copyGpsBtn) {
        const coords = copyGpsBtn.getAttribute("data-copy-gps");
        copyTextSafe(coords);
        showToast(`Copied GPS: ${coords}`);
        return;
      }

      const gt = e.target.closest("[data-group-toggle]");
      if (gt) {
        toggleGroupSelection(gt.getAttribute("data-group-toggle"));
        return;
      }

      const groupTr = e.target.closest("tr.group-row");
      if (groupTr) {
        const groupChk = groupTr.querySelector("[data-group-toggle]");
        if (groupChk) {
          toggleGroupSelection(groupChk.getAttribute("data-group-toggle"));
        }
        return;
      }

      const editBtn = e.target.closest("[data-edit-tag]");
      if (editBtn) {
        hideTooltip();
        closeAllDropdowns();
        state.editingTagUid = editBtn.getAttribute("data-edit-tag");
        render();
        syncAllDropdowns();
        const inp =
          metadataTableBody.querySelector("#inlineEditVal") ||
          metadataTableBody.querySelector("#inlineGpsLat");
        if (inp) {
          const editRow = inp.closest("tr");
          if (editRow) scrollRowIntoTable(editRow);
          inp.focus({ preventScroll: true });
          inp.select();
        }
        return;
      }

      const resetBtn = e.target.closest("[data-reset-tag]");
      if (resetBtn) {
        hideTooltip();
        resetTagValue(resetBtn.getAttribute("data-reset-tag"));
        return;
      }

      const delTagBtn = e.target.closest("[data-del-tag]");
      if (delTagBtn) {
        hideTooltip();
        deleteTag(delTagBtn.getAttribute("data-del-tag"));
        return;
      }

      if (e.target.id === "btnClearInlineVal") {
        if (state.editingTagUid) commitInlineEdit(state.editingTagUid, "");
        return;
      }
      if (e.target.id === "btnSaveInlineEdit") {
        if (state.editingTagUid) {
          commitInlineEdit(state.editingTagUid, readEditorValue());
        }
        return;
      }
      if (e.target.id === "btnRemoveGps") {
        removeAllGpsOnActive();
        return;
      }
      if (e.target.id === "btnCancelInlineEdit") {
        cancelInlineEdit(state.editingTagUid);
        return;
      }

      if (!e.target.closest("button, input, a")) {
        const cell = e.target.closest("td.col-chk, td.col-field");
        if (cell && !window.getSelection?.()?.toString()) {
          const tr = cell.closest("tr");
          const chk = tr?.querySelector("input.tag-chk[data-tag-uid]");
          if (chk && !chk.disabled) {
            toggleTagSelection(chk.getAttribute("data-tag-uid"), !chk.checked);
          }
        }
      }
    },
    { signal }
  );

  metadataTableBody.addEventListener(
    "input",
    (e) => {
      if (
        e.target.id === "inlineEditVal" ||
        e.target.id === "inlineGpsLat" ||
        e.target.id === "inlineGpsLon"
      ) {
        clearInputError(
          e.target,
          metadataTableBody.querySelector("#inlineEditErr")
        );
      }
    },
    { signal }
  );

  metadataTableBody.addEventListener(
    "keydown",
    (e) => {
      if (
        e.target.id === "inlineEditVal" ||
        e.target.id === "inlineGpsLat" ||
        e.target.id === "inlineGpsLon"
      ) {
        if (e.key === "Enter") {
          e.preventDefault();
          if (state.editingTagUid) {
            commitInlineEdit(state.editingTagUid, readEditorValue());
          }
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelInlineEdit(state.editingTagUid);
        }
      }
    },
    { signal }
  );

  metadataTableBody.addEventListener(
    "change",
    (e) => {
      if (
        e.target.hasAttribute("data-tag-uid") &&
        e.target.classList.contains("tag-chk")
      ) {
        toggleTagSelection(
          e.target.getAttribute("data-tag-uid"),
          e.target.checked
        );
      }
    },
    { signal }
  );

  metadataTableBody.addEventListener(
    "dblclick",
    (e) => {
      const tr = e.target.closest("tr");
      if (
        !tr ||
        e.target.closest("button, input, a") ||
        e.target.closest("td") !== tr.cells[2]
      ) {
        return;
      }
      const b = tr.querySelector("[data-edit-tag]");
      if (b) b.click();
    },
    { signal }
  );

  function buildGroupRow(gk, tags, active) {
    const g = GROUPS.find((x) => x.key === gk);
    const members = tags.filter((t) => groupOf(t) === gk);
    const togg = members.filter((t) => !isLockedTag(t));
    const nSel = togg.filter((t) => active.selectedTagUids.has(t.uid)).length;
    const nKept = members.length - nSel;
    const metaText =
      nKept > 0 && nSel > 0
        ? `${nKept} kept, ${nSel} to remove`
        : nKept > 0
          ? `${nKept} kept`
          : `${nSel} to remove`;
    const tr = document.createElement("tr");
    tr.className = togg.length
      ? "group-row group-row--toggleable"
      : "group-row";
    tr.innerHTML = `<td class="col-chk">${togg.length ? `<input type="checkbox" name="group_${g.key}" class="tag-chk" data-group-toggle="${g.key}" aria-label="Remove all: ${g.title}">` : ""}</td><td colspan="2"><div class="group-head-inner"><span class="group-head-title">${g.title}</span><span class="group-head-meta">${metaText}</span></div></td>`;
    syncTriStateCheckbox(tr.querySelector("input"), nSel, togg.length);
    return tr;
  }

  function hide() {
    emptyEl.classList.add("hidden");
    headerEl.classList.add("hidden");
    wrapEl.classList.add("hidden");
  }

  function render() {
    const active = getActiveItem();
    if (!active) {
      inspectStateBadge.textContent = "No file selected";
      emptyEl.classList.remove("hidden");
      headerEl.classList.add("hidden");
      wrapEl.classList.add("hidden");
      btnApplyCurrent.disabled = true;
      btnDownloadCurrent.disabled = true;
      btnApplyCurrent.classList.remove("btn-primary");
      btnDownloadCurrent.classList.remove("btn-primary");
      return;
    }

    emptyEl.classList.add("hidden");
    headerEl.classList.remove("hidden");
    wrapEl.classList.remove("hidden");

    if (document.activeElement !== inputCustomName) {
      inputCustomName.value = active.customBaseName;
    }
    inspectExtBadge.textContent = active.ext;

    btnApplyCurrent.disabled = active.isCleaned;
    btnDownloadCurrent.disabled = !active.isCleaned;
    btnApplyCurrent.classList.toggle("btn-primary", !active.isCleaned);
    btnDownloadCurrent.classList.toggle("btn-primary", active.isCleaned);
    btnApplyCurrentText.textContent = active.isCleaned
      ? "Done"
      : getPrimaryActionLabels(active).idle;
    btnDownloadCurrentText.textContent = "Download";
    btnDownloadZipHeader.classList.toggle("hidden", state.items.length < 2);
    btnDownloadZipHeader.disabled = state.items.length < 2;

    if (active.isCleaned) {
      inspectStateBadge.textContent = verifyBad(active)
        ? verifyText(active)
        : `Cleaned (${active.metadataTags.filter((t) => !active.selectedTagUids.has(t.uid)).length} of ${active.metadataTags.length} kept)`;
    } else {
      inspectStateBadge.textContent = `${active.selectedTagUids.size} of ${active.metadataTags.filter((t) => !isLockedTag(t)).length} to remove`;
    }

    const defaultSelCount = active.metadataTags.filter(
      (t) => !(isProfileTag(t) || isLockedTag(t))
    ).length;
    const hasSelectionDiff =
      active.selectedTagUids.size !== defaultSelCount ||
      active.metadataTags.some(
        (t) =>
          !(
            isProfileTag(t) ||
            isLockedTag(t) ||
            active.selectedTagUids.has(t.uid)
          )
      );

    btnOpenAddTag.disabled = !active.hasExifSlot;
    btnOpenAddTag.removeAttribute("data-tooltip");
    btnOpenAddTag.setAttribute(
      "data-tooltip-disabled",
      "Not supported for this file"
    );

    btnResetFile.classList.toggle(
      "hidden",
      !(active.isCleaned || active.hasEdits || hasSelectionDiff)
    );
    btnApplyEditsToAll.classList.toggle(
      "hidden",
      !(active.hasEdits && state.items.length > 1)
    );

    const filterableTags = active.metadataTags.filter((t) => !isLockedTag(t));
    const presentCats = new Set(
      filterableTags.map((t) => String(t.category || "").toLowerCase())
    );
    for (const opt of categoryFilterSelect.options) {
      if (opt.value === "ALL") {
        opt.disabled = false;
        opt.textContent = `All categories (${filterableTags.length})`;
      } else {
        const cnt = filterableTags.filter(
          (t) =>
            String(t.category || "").toLowerCase() === opt.value.toLowerCase()
        ).length;
        opt.disabled = cnt === 0 && state.categoryFilter !== opt.value;
        opt.textContent = cnt > 0 ? `${opt.value} (${cnt})` : opt.value;
      }
    }
    if (
      state.categoryFilter !== "ALL" &&
      !presentCats.has(state.categoryFilter.toLowerCase())
    ) {
      state.categoryFilter = "ALL";
      categoryFilterSelect.value = "ALL";
    } else {
      categoryFilterSelect.value = state.categoryFilter;
    }

    const currentFilter = state.categoryFilter;
    const visibleBase =
      currentFilter === "ALL"
        ? active.metadataTags
        : active.metadataTags.filter(
            (t) => t.category.toLowerCase() === currentFilter.toLowerCase()
          );
    const visibleTags = sortForDisplay(visibleBase);
    const visibleRemovable = visibleTags.filter((t) => !isLockedTag(t));
    const visibleSelectedCount = visibleRemovable.filter((t) =>
      active.selectedTagUids.has(t.uid)
    ).length;

    syncTriStateCheckbox(
      masterCheckbox,
      visibleSelectedCount,
      visibleRemovable.length
    );

    const activeFocusEl = document.activeElement;
    const focusTagUid = activeFocusEl?.getAttribute
      ? activeFocusEl.getAttribute("data-tag-uid")
      : null;
    const focusGroupKey = activeFocusEl?.getAttribute
      ? activeFocusEl.getAttribute("data-group-toggle")
      : null;

    let inlineDraft = null;
    if (state.editingTagUid) {
      const edVal = metadataTableBody.querySelector("#inlineEditVal");
      const edLat = metadataTableBody.querySelector("#inlineGpsLat");
      const edLon = metadataTableBody.querySelector("#inlineGpsLon");
      if (edVal) {
        inlineDraft = {
          uid: state.editingTagUid,
          kind: "text",
          val: edVal.value,
          focused: document.activeElement === edVal,
          selStart: edVal.selectionStart,
          selEnd: edVal.selectionEnd,
        };
      } else if (edLat || edLon) {
        inlineDraft = {
          uid: state.editingTagUid,
          kind: "gps",
          lat: edLat ? edLat.value : "",
          lon: edLon ? edLon.value : "",
          focusedId: document.activeElement ? document.activeElement.id : null,
        };
      }
    }

    metadataTableBody.innerHTML = "";
    if (visibleTags.length === 0) {
      const emptyMsg =
        currentFilter === "ALL"
          ? active.hasExifSlot
            ? 'No metadata found. Click "+ Add" to add a field.'
            : "No metadata found — file is already clean."
          : `No fields in "${currentFilter}".`;
      metadataTableBody.innerHTML = `<tr><td colspan="3" class="t-sub table-empty-cell">${escapeHtml(emptyMsg)}</td></tr>`;
      return;
    }

    const hasGpsLoc = visibleTags.some((t) => t.id === "GPS:LOC");
    const rawGpsCount = hasGpsLoc ? visibleTags.filter(isGpsRaw).length : 0;
    const isGpsRawOpen = expandedGpsRawFiles.has(active.id);

    let lastGroup = null;
    for (const tag of visibleTags) {
      const gk = groupOf(tag);
      if (gk !== lastGroup) {
        lastGroup = gk;
        metadataTableBody.appendChild(buildGroupRow(gk, visibleTags, active));
      }
      if (hasGpsLoc && isGpsRaw(tag) && !isGpsRawOpen) continue;

      const tr = document.createElement("tr");
      if (isGpsRaw(tag) && hasGpsLoc) {
        tr.classList.add("tag-row-sub");
      }
      const isChecked = active.selectedTagUids.has(tag.uid);
      const isEditing = state.editingTagUid === tag.uid;
      const isThumbnailTag = tag.id === "IFD1:THUMB";
      tr.classList.add(isChecked ? "tag-row-remove" : "tag-row-keep");
      if (!isLockedTag(tag)) tr.classList.add("tag-row-toggleable");
      if (tag.edited) tr.classList.add("tag-row-edited");

      let valueContentHtml = "";
      const isGpsEdit = tag.id === "GPS:LOC";
      const gpsParts = isGpsEdit
        ? String(tag.value)
            .split(",")
            .map((x) => x.trim())
        : [];

      if (isEditing) {
        valueContentHtml = `
          <div>
            <div class="flex items-center gap-1 inline-edit-row">
              <label for="${isGpsEdit ? "inlineGpsLat" : "inlineEditVal"}" class="hidden">Edit value for ${escapeHtml(tag.label)}</label>
              ${
                isGpsEdit
                  ? `<input type="number" step="any" min="-90" max="90" id="inlineGpsLat" name="inlineGpsLat" class="input input-sm input-gps" placeholder="Latitude" value="${escapeHtml(gpsParts[0] || "")}" aria-label="Latitude, -90 to 90"><input type="number" step="any" min="-180" max="180" id="inlineGpsLon" name="inlineGpsLon" class="input input-sm input-gps" placeholder="Longitude" value="${escapeHtml(gpsParts[1] || "")}" aria-label="Longitude, -180 to 180">`
                  : `<input type="text" id="inlineEditVal" name="inlineEditValue" class="input input-sm" value="${escapeHtml(tag.value)}" aria-label="Edit value for ${escapeHtml(tag.label)}">`
              }
              <button id="btnSaveInlineEdit" class="btn btn-sm btn-primary" type="button" aria-label="Save changes">Save</button>
              ${
                isGpsEdit
                  ? '<button id="btnRemoveGps" class="btn btn--subtle btn-sm" type="button">Remove GPS</button>'
                  : '<button id="btnClearInlineVal" class="btn btn--subtle btn-sm" type="button" aria-label="Remove this field">Remove field</button>'
              }
              <button id="btnCancelInlineEdit" class="btn btn--ghost btn-sm" type="button" aria-label="Cancel editing">Cancel</button>
            </div>
            <div id="inlineEditErr" class="inline-edit-err hidden" role="alert"></div>
          </div>
        `;
      } else {
        const rawStr = String(tag.value || "");
        const isLongVal = rawStr.length > 220;
        const isExpanded = state.expandedTagUids.has(tag.uid);
        const shownStr =
          isLongVal && !isExpanded ? `${rawStr.slice(0, 220)}…` : rawStr;
        const displayedVal =
          rawStr === ""
            ? '<span class="t-sub">&lt;empty&gt;</span>'
            : escapeHtml(shownStr);

        let extraBtns = "";
        if (tag.thumbUrl && isThumbnailTag) {
          extraBtns += `<button data-view-thumb="${escapeHtml(tag.thumbUrl)}" data-thumb-size="${escapeHtml(tag.thumbBytesLength || 0)}" class="btn btn--subtle btn-sm val-inline-btn" type="button" aria-label="Open embedded thumbnail in viewer">View</button>`;
        }
        if (tag.gpsCoordsRaw && tag.value !== "") {
          extraBtns += `<button data-copy-gps="${escapeHtml(tag.gpsCoordsRaw)}" class="btn btn--subtle btn-sm val-inline-btn" type="button" aria-label="Copy GPS coordinates to clipboard">Copy GPS</button>`;
        }
        if (tag.id === "GPS:LOC" && rawGpsCount > 0) {
          const gpsRawLabel = isGpsRawOpen
            ? "Hide raw tags"
            : `${rawGpsCount} raw ${rawGpsCount === 1 ? "tag" : "tags"}`;
          extraBtns += `<button data-toggle-gps-raw="${escapeHtml(active.id)}" class="btn btn--subtle btn-sm val-inline-btn" type="button" aria-expanded="${isGpsRawOpen ? "true" : "false"}">${gpsRawLabel}</button>`;
        }
        if (isLongVal) {
          extraBtns += `<button data-toggle-expand="${escapeHtml(tag.uid)}" class="btn btn--subtle btn-sm val-inline-btn" type="button">${isExpanded ? "Show less" : "Show more"}</button>`;
        }

        const statusPill = tag.edited
          ? badgeHtml("Modified")
          : isChecked || isLockedTag(tag) || isProfileTag(tag)
            ? ""
            : badgeHtml("Keep");

        const valClasses = [
          "val-text",
          isLongVal || rawStr.length > 36 || extraBtns
            ? "val-text--wrap"
            : "val-text--truncate",
          active.isCleaned && isChecked ? "val-text--removed" : "",
        ]
          .filter(Boolean)
          .join(" ");

        valueContentHtml = `
          <div class="flex items-center justify-between gap-2">
            <span class="inline-flex items-center gap-2 val-content">
              <span class="${valClasses}">${displayedVal}</span>
              ${extraBtns}
              ${statusPill}
            </span>
            <div class="flex items-center gap-1 val-actions">
              ${tag.edited && !tag.isCustom ? `<button data-reset-tag="${escapeHtml(tag.uid)}" class="btn btn--ghost btn-sm val-inline-btn" type="button" aria-label="Reset ${escapeHtml(tag.label)} to original value">Reset</button>` : ""}
              ${tag.isCustom ? `<button data-del-tag="${escapeHtml(tag.uid)}" class="btn btn--danger btn-sm val-inline-btn" type="button" aria-label="Delete ${escapeHtml(tag.label)} field">Delete</button>` : ""}
              ${!isThumbnailTag && isEditableTag(tag) ? `<button data-edit-tag="${escapeHtml(tag.uid)}" class="btn btn--ghost btn-sm btn-edit" type="button" data-tooltip="Edit" aria-label="Edit value for ${escapeHtml(tag.label)}">${ICONS.edit}</button>` : ""}
            </div>
          </div>
        `;
      }

      tr.innerHTML = `
        <td class="col-chk"><input type="checkbox" name="tag_${escapeHtml(tag.uid)}" data-tag-uid="${escapeHtml(tag.uid)}" class="tag-chk" ${isChecked ? "checked" : ""} ${isLockedTag(tag) ? 'disabled data-tooltip="Kept so the photo stays upright"' : ""} aria-label="Remove field ${escapeHtml(tag.label)} on export"></td>
        <td class="col-field" data-tooltip="Tag ID: ${escapeHtml(tag.id)}">${escapeHtml(tag.label)}</td>
        <td class="col-val">${valueContentHtml}</td>
      `;
      metadataTableBody.appendChild(tr);
    }

    if (inlineDraft && inlineDraft.uid === state.editingTagUid) {
      if (inlineDraft.kind === "text") {
        const edVal = metadataTableBody.querySelector("#inlineEditVal");
        if (edVal) {
          edVal.value = inlineDraft.val;
          if (inlineDraft.focused) {
            edVal.focus({ preventScroll: true });
            if (inlineDraft.selStart !== null && inlineDraft.selEnd !== null) {
              edVal.setSelectionRange(inlineDraft.selStart, inlineDraft.selEnd);
            }
          }
        }
      } else if (inlineDraft.kind === "gps") {
        const edLat = metadataTableBody.querySelector("#inlineGpsLat");
        const edLon = metadataTableBody.querySelector("#inlineGpsLon");
        if (edLat) edLat.value = inlineDraft.lat;
        if (edLon) edLon.value = inlineDraft.lon;
        if (inlineDraft.focusedId) {
          const fEl = metadataTableBody.querySelector(
            `#${inlineDraft.focusedId}`
          );
          if (fEl) fEl.focus({ preventScroll: true });
        }
      }
    }

    if (focusTagUid) {
      const restoreChk = metadataTableBody.querySelector(
        `[data-tag-uid="${CSS.escape(focusTagUid)}"]`
      );
      if (restoreChk) restoreChk.focus();
    } else if (focusGroupKey) {
      const restoreGrp = metadataTableBody.querySelector(
        `[data-group-toggle="${CSS.escape(focusGroupKey)}"]`
      );
      if (restoreGrp) restoreGrp.focus();
    }
    syncToolbarActionsWidth();
    syncTableScrollFade();
  }

  function destroy() {
    if (headActionsObserver) headActionsObserver.disconnect();
    if (tblScrollObserver) tblScrollObserver.disconnect();
    expandedGpsRawFiles.clear();
    controller.abort();
    emptyEl.remove();
    headerEl.remove();
    wrapEl.remove();
  }

  return { fragment, render, hide, destroy };
}
