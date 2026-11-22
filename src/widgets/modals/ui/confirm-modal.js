import { bindDialogBackdropClose } from "../../../shared/ui/index.js";

export function createConfirmModal() {
  const controller = new AbortController();
  const { signal } = controller;

  const dialog = document.createElement("dialog");
  dialog.id = "confirmModal";
  dialog.className = "modal-dialog modal-dialog--sm";
  dialog.setAttribute("aria-labelledby", "confirmText");
  dialog.innerHTML = `
    <div class="modal-body">
      <p id="confirmText" class="t-info"></p>
    </div>
    <div class="modal-foot">
      <button id="btnConfirmNo" class="btn btn--ghost btn-sm" type="button">Cancel</button>
      <button id="btnConfirmYes" class="btn btn-sm btn-primary" type="button">Confirm</button>
    </div>
  `;

  const confirmText = dialog.querySelector("#confirmText");
  const btnNo = dialog.querySelector("#btnConfirmNo");
  const btnYes = dialog.querySelector("#btnConfirmYes");

  bindDialogBackdropClose(dialog, () => dialog.close(), signal);

  function askConfirm(message, yesLabel) {
    if (dialog.open) return Promise.resolve(false);
    return new Promise((resolve) => {
      let result = false;
      confirmText.textContent = message;
      btnYes.textContent = yesLabel || "Confirm";
      btnYes.onclick = () => {
        result = true;
        dialog.close();
      };
      btnNo.onclick = () => dialog.close();
      dialog.addEventListener("close", () => resolve(result), {
        once: true,
        signal,
      });
      dialog.showModal();
    });
  }

  function destroy() {
    if (dialog.open) dialog.close();
    btnYes.onclick = null;
    btnNo.onclick = null;
    controller.abort();
    dialog.remove();
  }

  return { el: dialog, askConfirm, destroy };
}
