import { state } from "../../../entities/image-file/index.js";
import {
  formatBytes,
  generateCsprngToken,
  triggerBlobDownload,
} from "../../../shared/lib/index.js";
import {
  bindDialogBackdropClose,
  ICONS,
  showToast,
} from "../../../shared/ui/index.js";

export function createThumbPreviewModal() {
  const controller = new AbortController();
  const { signal } = controller;

  const dialog = document.createElement("dialog");
  dialog.id = "thumbPreviewModal";
  dialog.className = "modal-dialog modal-dialog--lg";
  dialog.setAttribute("aria-labelledby", "thumbPreviewTitle");
  dialog.innerHTML = `
    <div class="modal-head">
      <h2 id="thumbPreviewTitle">Embedded thumbnail</h2>
      <button id="btnCloseThumbModal" class="btn btn--ghost icon-btn btn-sm" type="button" data-tooltip="Close" aria-label="Close thumbnail dialog">${ICONS.close}</button>
    </div>
    <div class="modal-body">
      <div class="preview-img-container">
        <img id="thumbModalImg" src="" alt="Embedded preview frame" />
      </div>
    </div>
    <div class="modal-foot modal-foot--between">
      <span id="thumbModalMeta" class="badge">Size: —</span>
      <div class="flex items-center gap-2">
        <button id="btnDownloadThumb" class="btn btn--subtle btn-sm" type="button">Save</button>
        <button id="btnCloseThumbBtn" class="btn btn-sm btn-primary" type="button">Close</button>
      </div>
    </div>
  `;

  const imgEl = dialog.querySelector("#thumbModalImg");
  const metaEl = dialog.querySelector("#thumbModalMeta");
  const btnClose = dialog.querySelector("#btnCloseThumbModal");
  const btnCloseBottom = dialog.querySelector("#btnCloseThumbBtn");
  const btnDownload = dialog.querySelector("#btnDownloadThumb");

  function close() {
    if (dialog.open) {
      dialog.close();
    }
    imgEl.removeAttribute("src");
  }

  function open(url, sizeBytes) {
    state.activeThumbModalUrl = url;
    imgEl.src = url;
    metaEl.textContent = `Size: ${formatBytes(sizeBytes || 0)}`;
    dialog.showModal();
  }

  btnClose.addEventListener("click", close, { signal });
  btnCloseBottom.addEventListener("click", close, { signal });
  bindDialogBackdropClose(dialog, close, signal);

  btnDownload.addEventListener(
    "click",
    () => {
      if (!state.activeThumbModalUrl) {
        return;
      }
      triggerBlobDownload(
        state.activeThumbModalUrl,
        `THUMB_${generateCsprngToken().slice(0, 6)}.jpg`
      );
      showToast("Saved preview image");
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
