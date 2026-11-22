let toastBoxEl = null;
let toastTextEl = null;
let toastTimer = null;

export function initToast(boxEl, textEl) {
  toastBoxEl = boxEl;
  toastTextEl = textEl;

  return function destroyToast() {
    clearTimeout(toastTimer);
    toastTimer = null;
    if (toastBoxEl) {
      toastBoxEl.remove();
      toastBoxEl = null;
    }
    toastTextEl = null;
  };
}

export function showToast(msg) {
  if (!(toastBoxEl && toastTextEl)) return;
  const openDialog = document.querySelector("dialog[open]") || document.body;
  if (toastBoxEl.parentElement !== openDialog)
    openDialog.appendChild(toastBoxEl);
  toastTextEl.textContent = msg;
  toastBoxEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (toastBoxEl) toastBoxEl.classList.remove("show");
  }, 2000);
}
