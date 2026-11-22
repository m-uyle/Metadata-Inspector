import { ICONS } from "../../../shared/ui/index.js";

export function createDropOverlay() {
  const el = document.createElement("div");
  el.id = "dropOverlay";
  el.className = "overlay-backdrop";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="drop-overlay-card">
      ${ICONS.plusMd}
      <span>Drop files to add</span>
    </div>
  `;

  function setActive(active) {
    el.classList.toggle("active", active);
    el.setAttribute("aria-hidden", String(!active));
  }

  function destroy() {
    el.remove();
  }

  return { el, setActive, destroy };
}
