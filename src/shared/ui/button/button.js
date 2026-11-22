export function createButton({
  id,
  label = "",
  iconHtml = "",
  variant = "default",
  size = "md",
  iconOnly = false,
  disabled = false,
  tooltip,
  tooltipDisabled,
  ariaLabel,
  className = "",
  dataset,
  onClick,
  signal,
} = {}) {
  const btn = document.createElement("button");
  btn.type = "button";

  const classes = ["btn"];
  if (variant === "primary") classes.push("btn-primary");
  else if (variant === "subtle") classes.push("btn--subtle");
  else if (variant === "ghost") classes.push("btn--ghost");
  else if (variant === "danger") classes.push("btn--danger");

  if (size === "sm") classes.push("btn-sm");
  else if (size === "xs") classes.push("btn-xs");

  if (iconOnly) classes.push("icon-btn");
  if (className) classes.push(className);
  btn.className = classes.join(" ");

  if (id) btn.id = id;
  btn.disabled = Boolean(disabled);
  if (ariaLabel) btn.setAttribute("aria-label", ariaLabel);
  if (tooltip) btn.setAttribute("data-tooltip", tooltip);
  if (tooltipDisabled)
    btn.setAttribute("data-tooltip-disabled", tooltipDisabled);
  if (dataset) {
    for (const [k, v] of Object.entries(dataset)) {
      btn.dataset[k] = v;
    }
  }

  if (iconHtml) btn.insertAdjacentHTML("beforeend", iconHtml);
  if (label) {
    const span = document.createElement("span");
    span.textContent = label;
    btn.appendChild(span);
  }

  if (onClick) {
    btn.addEventListener("click", onClick, signal ? { signal } : undefined);
  }
  return btn;
}

export async function withButtonBusy(
  btn,
  asyncFn,
  { textEl, busyLabel, idleLabel, isDisabledAfter } = {}
) {
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  if (textEl && busyLabel !== undefined) textEl.textContent = busyLabel;
  try {
    return await asyncFn();
  } finally {
    if (textEl && idleLabel !== undefined) textEl.textContent = idleLabel;
    btn.disabled =
      typeof isDisabledAfter === "function"
        ? Boolean(isDisabledAfter())
        : false;
  }
}
