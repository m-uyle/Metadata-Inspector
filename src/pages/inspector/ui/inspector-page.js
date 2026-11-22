import {
  getActiveItem,
  state,
  subscribe,
} from "../../../entities/image-file/index.js";
import { handleFiles } from "../../../features/import-files/index.js";
import {
  applyActiveFile,
  downloadActiveFile,
  downloadAllAsZip,
} from "../../../features/scrub-export/index.js";
import {
  initDropdowns,
  initToast,
  initTooltip,
  syncAllDropdowns,
} from "../../../shared/ui/index.js";
import { createBatchWorkspaceWidget } from "../../../widgets/batch-workspace/index.js";
import { createFileQueueWidget } from "../../../widgets/file-queue/index.js";
import { createMetadataInspectorWidget } from "../../../widgets/metadata-inspector/index.js";
import {
  createAddTagModal,
  createBatchProgressBar,
  createConfirmModal,
  createDropOverlay,
  createThumbPreviewModal,
} from "../../../widgets/modals/index.js";

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/apng",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/x-adobe-dng",
  "image/tiff",
  "image/x-canon-cr2",
  "image/x-canon-cr3",
  "image/x-nikon-nef",
  "image/x-sony-arw",
  "image/x-olympus-orf",
  "image/x-panasonic-rw2",
  "image/x-pentax-pef",
  "image/x-fuji-raf",
  ".jpg",
  ".jpeg",
  ".jpe",
  ".jfif",
  ".png",
  ".apng",
  ".webp",
  ".gif",
  ".heic",
  ".heif",
  ".hif",
  ".avif",
  ".dng",
  ".tif",
  ".tiff",
  ".cr2",
  ".cr3",
  ".nef",
  ".nrw",
  ".arw",
  ".sr2",
  ".orf",
  ".rw2",
  ".pef",
  ".srw",
  ".raf",
  ".3fr",
  ".fff",
  ".rwl",
].join(",");

function hasFilesPayload(dataTransfer) {
  if (!dataTransfer?.types) return false;
  return Array.from(dataTransfer.types).includes("Files");
}

export function mountInspectorPage(root) {
  const controller = new AbortController();
  const { signal } = controller;

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.id = "fileInput";
  fileInput.name = "files";
  fileInput.multiple = true;
  fileInput.accept = ACCEPTED_TYPES;
  fileInput.className = "hidden";
  fileInput.setAttribute("aria-hidden", "true");

  const dropOverlay = createDropOverlay();
  const confirmModal = createConfirmModal();
  const addTagModal = createAddTagModal();
  const thumbPreviewModal = createThumbPreviewModal();
  const batchProgressBar = createBatchProgressBar();

  const fileQueueWidget = createFileQueueWidget({
    onAddFilesClick: () => fileInput.click(),
    askConfirm: confirmModal.askConfirm,
  });

  const metadataInspectorWidget = createMetadataInspectorWidget({
    onAddFilesClick: () => fileInput.click(),
    onOpenAddTag: () => addTagModal.open(),
    onOpenThumbPreview: (url, sizeBytes) =>
      thumbPreviewModal.open(url, sizeBytes),
    onQueueNameChanged: () => fileQueueWidget.render(),
  });

  const batchWorkspaceWidget = createBatchWorkspaceWidget();

  const appShell = document.createElement("div");
  appShell.className = "app-shell";

  const mainEl = document.createElement("main");
  mainEl.className = "main";
  mainEl.setAttribute("role", "main");

  const srTitle = document.createElement("h1");
  srTitle.className = "sr-only";
  srTitle.textContent = "Metadata Inspector";

  mainEl.append(
    srTitle,
    metadataInspectorWidget.fragment,
    batchWorkspaceWidget.el
  );
  appShell.append(fileQueueWidget.el, mainEl);

  const tooltipEl = document.createElement("div");
  tooltipEl.id = "appTooltip";
  tooltipEl.className = "ui-tooltip";
  tooltipEl.setAttribute("role", "tooltip");
  tooltipEl.setAttribute("aria-hidden", "true");

  const toastBox = document.createElement("div");
  toastBox.id = "toastBox";
  toastBox.className = "toast-banner";
  toastBox.setAttribute("role", "status");
  toastBox.setAttribute("aria-live", "polite");
  const toastText = document.createElement("span");
  toastText.id = "toastText";
  toastBox.appendChild(toastText);

  root.replaceChildren(
    fileInput,
    dropOverlay.el,
    confirmModal.el,
    addTagModal.el,
    thumbPreviewModal.el,
    appShell,
    tooltipEl,
    toastBox,
    batchProgressBar.el
  );

  const destroyTooltip = initTooltip(tooltipEl);
  const destroyToast = initToast(toastBox, toastText);
  const destroyDropdowns = initDropdowns(root);

  function renderAll() {
    for (const id of Array.from(state.checkedIds)) {
      if (!state.items.some((i) => i.id === id)) state.checkedIds.delete(id);
    }
    state.batchMode = state.checkedIds.size > 1;
    fileQueueWidget.render();
    if (state.batchMode) {
      metadataInspectorWidget.hide();
      batchWorkspaceWidget.render();
    } else {
      batchWorkspaceWidget.hide();
      metadataInspectorWidget.render();
    }
    syncAllDropdowns();
  }

  const unsubscribeStore = subscribe(renderAll);

  fileInput.addEventListener(
    "change",
    (e) => {
      handleFiles(e.target.files);
      e.target.value = "";
    },
    { signal }
  );

  let dragCounter = 0;
  window.addEventListener(
    "dragenter",
    (e) => {
      if (!hasFilesPayload(e.dataTransfer)) return;
      e.preventDefault();
      dragCounter++;
      if (!document.querySelector("dialog[open]")) {
        dropOverlay.setActive(true);
      }
    },
    { signal }
  );
  window.addEventListener(
    "dragleave",
    (e) => {
      if (!hasFilesPayload(e.dataTransfer)) return;
      e.preventDefault();
      if (--dragCounter <= 0) {
        dragCounter = 0;
        dropOverlay.setActive(false);
      }
    },
    { signal }
  );
  window.addEventListener(
    "dragover",
    (e) => {
      if (hasFilesPayload(e.dataTransfer)) e.preventDefault();
    },
    { signal }
  );
  window.addEventListener(
    "drop",
    (e) => {
      if (!hasFilesPayload(e.dataTransfer)) return;
      e.preventDefault();
      dragCounter = 0;
      dropOverlay.setActive(false);
      if (document.querySelector("dialog[open]")) return;
      if (e.dataTransfer?.files.length) {
        handleFiles(e.dataTransfer.files);
      }
    },
    { signal }
  );
  window.addEventListener(
    "paste",
    (e) => {
      if (document.querySelector("dialog[open]")) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      if (e.clipboardData?.files.length) {
        handleFiles(e.clipboardData.files);
      }
    },
    { signal }
  );
  window.addEventListener(
    "keydown",
    async (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (document.querySelector("dialog[open]")) return;
      const key = e.key.toLowerCase();
      if (key === "o") {
        e.preventDefault();
        fileInput.click();
      } else if (key === "s") {
        e.preventDefault();
        if (state.batchMode) {
          await downloadAllAsZip();
          return;
        }
        const active = getActiveItem();
        if (!active) return;
        if (!active.isCleaned) {
          try {
            await applyActiveFile();
          } catch {
            return;
          }
        }
        downloadActiveFile();
      }
    },
    { signal }
  );
  window.addEventListener(
    "beforeunload",
    (e) => {
      if (state.items.some((i) => i.hasEdits && !i.isCleaned)) {
        e.preventDefault();
        e.returnValue = "";
      }
    },
    { signal }
  );

  renderAll();

  function destroy() {
    controller.abort();
    unsubscribeStore();
    destroyDropdowns();
    destroyTooltip();
    destroyToast();
    fileQueueWidget.destroy();
    metadataInspectorWidget.destroy();
    batchWorkspaceWidget.destroy();
    dropOverlay.destroy();
    confirmModal.destroy();
    addTagModal.destroy();
    thumbPreviewModal.destroy();
    batchProgressBar.destroy();
    root.replaceChildren();
  }

  return { destroy };
}
