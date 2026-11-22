export function bindDialogBackdropClose(dialog, onClose, signal) {
  dialog.addEventListener(
    "click",
    (e) => {
      if (
        e.target !== e.currentTarget ||
        (e.clientX === 0 && e.clientY === 0)
      ) {
        return;
      }
      const r = dialog.getBoundingClientRect();
      if (
        e.clientY < r.top ||
        e.clientY > r.bottom ||
        e.clientX < r.left ||
        e.clientX > r.right
      ) {
        onClose();
      }
    },
    { signal }
  );
}
