let tooltipEl = null;
let activeTooltipTarget = null;
let pendingTooltipTarget = null;
let tooltipDelayTimer = null;
let controller = null;

function positionTooltip(target) {
  if (!(tooltipEl && target)) return;
  const rect = target.getBoundingClientRect();
  const ttRect = tooltipEl.getBoundingClientRect();
  const rootFs =
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
    16;
  const gap = Math.round(rootFs * 0.5);
  let top = rect.top - ttRect.height - gap;
  if (top < gap) top = rect.bottom + gap;
  let left = rect.left + (rect.width - ttRect.width) / 2;
  left = Math.max(gap, Math.min(window.innerWidth - ttRect.width - gap, left));
  tooltipEl.style.top = `${Math.round(top)}px`;
  tooltipEl.style.left = `${Math.round(left)}px`;
}

function resolveTooltipText(target) {
  if (target.hasAttribute("data-tooltip-overflow")) {
    return target.scrollWidth > target.clientWidth
      ? target.getAttribute("data-tooltip-overflow")
      : null;
  }
  return target.disabled
    ? target.getAttribute("data-tooltip-disabled")
    : target.getAttribute("data-tooltip");
}

function displayTooltip(target) {
  if (!(tooltipEl && target?.isConnected)) return;
  const text = resolveTooltipText(target);
  if (!text) return;
  const hostDialog = target.closest("dialog[open]") || document.body;
  if (tooltipEl.parentElement !== hostDialog) hostDialog.appendChild(tooltipEl);
  activeTooltipTarget = target;
  pendingTooltipTarget = null;
  tooltipEl.textContent = text;
  tooltipEl.classList.add("visible");
  tooltipEl.setAttribute("aria-hidden", "false");
  positionTooltip(target);
}

export function showTooltipFor(target) {
  if (!(tooltipEl && target)) return;
  clearTimeout(tooltipDelayTimer);
  tooltipDelayTimer = null;
  pendingTooltipTarget = null;
  if (!resolveTooltipText(target)) return;

  const delay = Number.parseInt(
    target.getAttribute("data-tooltip-delay") || "0",
    10
  );
  if (delay > 0 && activeTooltipTarget !== target) {
    pendingTooltipTarget = target;
    tooltipDelayTimer = setTimeout(() => {
      tooltipDelayTimer = null;
      displayTooltip(target);
    }, delay);
    return;
  }
  displayTooltip(target);
}

export function hideTooltip() {
  clearTimeout(tooltipDelayTimer);
  tooltipDelayTimer = null;
  pendingTooltipTarget = null;
  activeTooltipTarget = null;
  if (tooltipEl) {
    tooltipEl.classList.remove("visible");
    tooltipEl.setAttribute("aria-hidden", "true");
  }
}

const TOOLTIP_SELECTOR =
  "[data-tooltip], [data-tooltip-disabled], [data-tooltip-overflow]";

export function initTooltip(element) {
  if (controller) controller.abort();
  controller = new AbortController();
  const { signal } = controller;
  tooltipEl = element;

  document.addEventListener(
    "pointerover",
    (e) => {
      const t = e.target.closest?.(TOOLTIP_SELECTOR);
      if (t) showTooltipFor(t);
    },
    { signal }
  );
  document.addEventListener(
    "pointerout",
    (e) => {
      const tracked = activeTooltipTarget || pendingTooltipTarget;
      if (tracked && !(e.relatedTarget && tracked.contains(e.relatedTarget))) {
        hideTooltip();
      }
    },
    { signal }
  );
  document.addEventListener(
    "focusin",
    (e) => {
      const t = e.target.closest?.(TOOLTIP_SELECTOR);
      if (t) showTooltipFor(t);
    },
    { signal }
  );
  document.addEventListener("focusout", () => hideTooltip(), { signal });
  document.addEventListener("pointerdown", () => hideTooltip(), {
    capture: true,
    signal,
  });
  window.addEventListener("scroll", () => hideTooltip(), {
    capture: true,
    signal,
  });

  return function destroyTooltip() {
    if (controller) {
      controller.abort();
      controller = null;
    }
    hideTooltip();
    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
  };
}
