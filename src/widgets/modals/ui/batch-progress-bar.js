import {
  batchRequestCancel,
  subscribeBatch,
} from "../../../entities/image-file/index.js";

export function createBatchProgressBar() {
  const controller = new AbortController();
  const { signal } = controller;

  const el = document.createElement("div");
  el.id = "batchBar";
  el.className = "batch-bar";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `
    <div class="flex-1">
      <div id="batchText" class="t-sub"></div>
      <div class="batch-bar-track">
        <div id="batchFill" class="batch-bar-fill"></div>
      </div>
    </div>
    <button id="batchStop" class="btn btn-sm" type="button">Stop</button>
  `;

  const textEl = el.querySelector("#batchText");
  const fillEl = el.querySelector("#batchFill");
  const stopBtn = el.querySelector("#batchStop");

  stopBtn.addEventListener(
    "click",
    () => {
      batchRequestCancel();
    },
    { signal }
  );

  const unsubscribe = subscribeBatch((b) => {
    el.classList.toggle("visible", b.active);
    if (!b.active) return;
    textEl.textContent = b.cancel
      ? "Stopping…"
      : `${b.label} ${b.done} / ${b.total}`;
    const pct = b.total ? Math.min(100, (b.done / b.total) * 100) : 0;
    fillEl.style.width = `${pct}%`;
  });

  function destroy() {
    unsubscribe();
    controller.abort();
    el.remove();
  }

  return { el, destroy };
}
