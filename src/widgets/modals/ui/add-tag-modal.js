import { getActiveItem } from "../../../entities/image-file/index.js";
import { computeAutoTagMeta } from "../../../entities/metadata-tag/index.js";
import { addOrUpdateCustomTag } from "../../../features/edit-metadata/index.js";
import { sanitizeString } from "../../../shared/lib/index.js";
import {
  bindDialogBackdropClose,
  clearInputError,
  closeAllDropdowns,
  ICONS,
  setInputError,
  showToast,
  syncAllDropdowns,
} from "../../../shared/ui/index.js";

const GIF_ALLOWED_PRESETS = new Set([
  "0x9286|Description|User Comment",
  "0x010E|Description|Image Description",
  "0x013B|Identity|Artist / Author",
  "0x8298|Identity|Copyright Notice",
  "CUSTOM",
]);

export function createAddTagModal() {
  const controller = new AbortController();
  const { signal } = controller;

  const dialog = document.createElement("dialog");
  dialog.id = "addTagModal";
  dialog.className = "modal-dialog";
  dialog.setAttribute("aria-labelledby", "addTagTitle");
  dialog.innerHTML = `
    <div class="modal-head">
      <h2 id="addTagTitle">Add metadata field</h2>
      <button id="btnCloseModal" class="btn btn--ghost icon-btn btn-sm" type="button" data-tooltip="Close" aria-label="Close dialog">${ICONS.close}</button>
    </div>
    <div class="modal-body">
      <div class="flex flex-col gap-1">
        <label class="t-sub" for="presetFieldBtn">Field</label>
        <select id="presetFieldSelect" name="presetField" class="hidden" aria-hidden="true" tabindex="-1">
          <option value="0x013B|Identity|Artist / Author">Artist / Author</option>
          <option value="0x8298|Identity|Copyright Notice">Copyright Notice</option>
          <option value="0x010E|Description|Image Description">Image Description</option>
          <option value="0x9286|Description|User Comment">User Comment</option>
          <option value="0x0131|Software|Software / Firmware">Software / Firmware</option>
          <option value="0x9003|Timestamp|Date/Time Original">Date/Time Original</option>
          <option value="0x010F|Hardware|Camera Make">Camera Make</option>
          <option value="0x0110|Hardware|Camera Model">Camera Model</option>
          <option value="0xA434|Hardware|Lens Model">Lens Model</option>
          <option value="0xA430|Identity|Owner Name">Owner Name</option>
          <option value="GPS:LOC|Geolocation|GPS Coordinates">GPS Coordinates</option>
          <option value="CUSTOM">Custom field…</option>
        </select>
        <div class="ui-dropdown ui-dropdown-full" data-dropdown="presetFieldSelect">
          <button id="presetFieldBtn" type="button" class="ui-dropdown-btn" aria-haspopup="listbox" aria-expanded="false">
            <span class="ui-dropdown-label truncate">Artist / Author</span>
            ${ICONS.chevronDown}
          </button>
          <div class="ui-dropdown-menu" role="listbox"></div>
        </div>
      </div>

      <div id="customTagNameWrap" class="flex flex-col gap-1 hidden">
        <label class="t-sub" for="customTagLabel">Custom field name</label>
        <input
          type="text"
          id="customTagLabel"
          name="customTagLabel"
          class="input"
          placeholder="e.g. Studio Name, Project ID..."
          autocomplete="off"
        />
      </div>

      <div id="customValSingleWrap" class="flex flex-col gap-1">
        <label class="t-sub" for="customTagValue">Field value</label>
        <input
          type="text"
          id="customTagValue"
          name="customTagValue"
          class="input"
          placeholder="Enter value"
          autocomplete="off"
        />
      </div>

      <div id="customValGpsWrap" class="flex gap-2 hidden">
        <div class="flex flex-col gap-1 flex-1">
          <label class="t-sub" for="customGpsLat">Latitude (-90 to 90)</label>
          <input type="number" step="any" min="-90" max="90" id="customGpsLat" name="customGpsLat" class="input" placeholder="60.170833" autocomplete="off" />
        </div>
        <div class="flex flex-col gap-1 flex-1">
          <label class="t-sub" for="customGpsLon">Longitude (-180 to 180)</label>
          <input type="number" step="any" min="-180" max="180" id="customGpsLon" name="customGpsLon" class="input" placeholder="24.938444" autocomplete="off" />
        </div>
      </div>

      <div id="customMetaRow" class="flex gap-2 hidden">
        <div class="flex flex-col gap-1 flex-1">
          <label class="t-sub" for="customCategoryBtn">Category</label>
          <select id="customCategorySelect" name="customCategory" class="hidden" aria-hidden="true" tabindex="-1">
            <option value="Identity">Identity</option>
            <option value="Description">Description</option>
            <option value="Timestamp">Timestamp</option>
            <option value="Hardware">Hardware</option>
            <option value="Optics">Optics</option>
            <option value="Geolocation">Geolocation</option>
            <option value="Software">Software</option>
            <option value="Custom">Custom</option>
          </select>
          <div class="ui-dropdown ui-dropdown-full" data-dropdown="customCategorySelect">
            <button id="customCategoryBtn" type="button" class="ui-dropdown-btn" aria-haspopup="listbox" aria-expanded="false">
              <span class="ui-dropdown-label truncate">Identity</span>
              ${ICONS.chevronDown}
            </button>
            <div class="ui-dropdown-menu" role="listbox"></div>
          </div>
        </div>
        <div class="flex flex-col gap-1 field-tag-id">
          <label class="t-sub" for="customTagId">Tag ID</label>
          <div class="input-group">
            <input
              type="text"
              id="customTagId"
              name="customTagId"
              class="input-group-inner"
              placeholder="0x0000"
              spellcheck="false"
              data-tooltip="EXIF tag ID (hex)"
            />
            <span id="tagIdAutoBadge" class="hud-ext-tag">AUTO</span>
          </div>
        </div>
      </div>
      <div id="addTagError" class="inline-edit-err hidden" role="alert"></div>
    </div>
    <div class="modal-foot">
      <button id="btnCancelModal" class="btn btn--ghost btn-sm" type="button">Cancel</button>
      <button id="btnConfirmAddTag" class="btn btn-sm btn-primary" type="button">Save field</button>
    </div>
  `;

  const presetFieldSelect = dialog.querySelector("#presetFieldSelect");
  const customTagNameWrap = dialog.querySelector("#customTagNameWrap");
  const customTagLabel = dialog.querySelector("#customTagLabel");
  const customValSingleWrap = dialog.querySelector("#customValSingleWrap");
  const customTagValue = dialog.querySelector("#customTagValue");
  const customValGpsWrap = dialog.querySelector("#customValGpsWrap");
  const customGpsLat = dialog.querySelector("#customGpsLat");
  const customGpsLon = dialog.querySelector("#customGpsLon");
  const customMetaRow = dialog.querySelector("#customMetaRow");
  const customCategorySelect = dialog.querySelector("#customCategorySelect");
  const customTagId = dialog.querySelector("#customTagId");
  const tagIdAutoBadge = dialog.querySelector("#tagIdAutoBadge");
  const addTagError = dialog.querySelector("#addTagError");
  const btnCloseModal = dialog.querySelector("#btnCloseModal");
  const btnCancelModal = dialog.querySelector("#btnCancelModal");
  const btnConfirmAddTag = dialog.querySelector("#btnConfirmAddTag");

  const formInputs = [
    customTagLabel,
    customTagValue,
    customGpsLat,
    customGpsLon,
    customTagId,
  ];

  let userManuallyEditedTagId = false;
  let focusTimer = null;

  function clearError() {
    clearInputError(formInputs, addTagError);
  }

  function showError(msg, targetInput) {
    setInputError(targetInput, addTagError, msg);
    showToast(msg);
  }

  function syncAutoTagId(updateCategoryToo = true) {
    if (userManuallyEditedTagId) return;
    const info = computeAutoTagMeta(
      customTagLabel.value,
      customCategorySelect.value,
      getActiveItem()
    );
    customTagId.value = info.id;
    if (updateCategoryToo && info.matched) {
      customCategorySelect.value = info.cat;
      syncAllDropdowns();
    }
    tagIdAutoBadge.textContent = info.matched ? "MATCH" : "AUTO";
  }

  function syncMode() {
    clearError();
    syncAllDropdowns();
    const presetVal = presetFieldSelect.value;
    const isCustom = presetVal === "CUSTOM";
    const isGps = presetVal.startsWith("GPS:LOC|");
    customTagNameWrap.classList.toggle("hidden", !isCustom);
    customMetaRow.classList.toggle("hidden", !isCustom);
    customValSingleWrap.classList.toggle("hidden", isGps);
    customValGpsWrap.classList.toggle("hidden", !isGps);
    if (!(isCustom || isGps)) {
      const [id] = presetVal.split("|");
      customTagValue.placeholder =
        id === "0x9003" ? "YYYY:MM:DD HH:MM:SS" : "Enter value";
    } else if (isCustom) {
      customTagValue.placeholder = "Enter value";
      syncAutoTagId(false);
    }
  }

  function close() {
    clearTimeout(focusTimer);
    focusTimer = null;
    closeAllDropdowns();
    clearError();
    if (dialog.open) dialog.close();
  }

  function open() {
    closeAllDropdowns();
    const active = getActiveItem();
    if (!active) {
      showToast("Select an image first");
      return;
    }
    if (!active.hasExifSlot) {
      showToast(`This ${active.format} file doesn't support adding fields`);
      return;
    }
    userManuallyEditedTagId = false;
    for (const opt of presetFieldSelect.options) {
      opt.disabled =
        active.format === "GIF" ? !GIF_ALLOWED_PRESETS.has(opt.value) : false;
    }
    presetFieldSelect.value =
      active.format === "GIF"
        ? "0x9286|Description|User Comment"
        : "0x013B|Identity|Artist / Author";
    customTagLabel.value = "";
    customTagValue.value = "";
    customGpsLat.value = "";
    customGpsLon.value = "";
    customCategorySelect.value = "Custom";
    syncMode();
    syncAllDropdowns();
    dialog.showModal();
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => customTagValue.focus(), 30);
  }

  presetFieldSelect.addEventListener(
    "change",
    () => {
      syncMode();
      if (presetFieldSelect.value === "CUSTOM") customTagLabel.focus();
      else if (presetFieldSelect.value.startsWith("GPS:LOC|"))
        customGpsLat.focus();
      else customTagValue.focus();
    },
    { signal }
  );

  customTagLabel.addEventListener("input", () => syncAutoTagId(true), {
    signal,
  });
  customCategorySelect.addEventListener("change", () => syncAutoTagId(false), {
    signal,
  });
  customTagId.addEventListener(
    "input",
    () => {
      userManuallyEditedTagId = customTagId.value.trim().length > 0;
      tagIdAutoBadge.textContent = userManuallyEditedTagId ? "MANUAL" : "AUTO";
      if (!userManuallyEditedTagId) syncAutoTagId(false);
    },
    { signal }
  );

  btnCloseModal.addEventListener("click", close, { signal });
  btnCancelModal.addEventListener("click", close, { signal });
  dialog.addEventListener("input", clearError, { signal });
  bindDialogBackdropClose(dialog, close, signal);
  dialog.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter" && e.target.tagName === "INPUT") {
        e.preventDefault();
        btnConfirmAddTag.click();
      }
    },
    { signal }
  );

  btnConfirmAddTag.addEventListener(
    "click",
    () => {
      const active = getActiveItem();
      if (!active) return;
      clearError();
      const presetVal = presetFieldSelect.value;
      const isCustom = presetVal === "CUSTOM";
      const isGps = presetVal.startsWith("GPS:LOC|");

      let id;
      let cat;
      let label;
      if (isCustom) {
        label = customTagLabel.value.trim() || "Custom Field";
        cat = customCategorySelect.value;
        id =
          customTagId.value.trim() || computeAutoTagMeta(label, cat, active).id;
        if (/^0x[0-9a-fA-F]{1,4}$/.test(id)) {
          id =
            "0x" +
            Number.parseInt(id.slice(2), 16)
              .toString(16)
              .toUpperCase()
              .padStart(4, "0");
        }
      } else {
        [id, cat, label] = presetVal.split("|");
      }

      const value = isGps
        ? `${customGpsLat.value.trim()}, ${customGpsLon.value.trim()}`
        : sanitizeString(customTagValue.value.trim());

      if (isGps && !(customGpsLat.value.trim() && customGpsLon.value.trim())) {
        showError(
          "Enter both latitude and longitude",
          customGpsLat.value.trim() ? customGpsLon : customGpsLat
        );
        return;
      }
      if (!value) {
        showError("Enter a value", customTagValue);
        return;
      }

      const res = addOrUpdateCustomTag({
        id,
        cat,
        label,
        value,
        isCustom,
        hasCustomLabel: !!customTagLabel.value.trim(),
      });
      if (!res.ok) {
        const target =
          res.field === "id"
            ? customTagId
            : isGps
              ? customGpsLat
              : customTagValue;
        showError(res.error, target);
        return;
      }
      close();
    },
    { signal }
  );

  function destroy() {
    close();
    controller.abort();
    dialog.remove();
  }

  return { el: dialog, open, destroy };
}
