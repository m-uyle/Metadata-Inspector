export function createCheckbox({
  id,
  name,
  checked = false,
  indeterminate = false,
  disabled = false,
  ariaLabel,
  tooltip,
  tooltipDelay,
  className = "",
  dataset,
  onChange,
  signal,
} = {}) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = className ? `tag-chk ${className}` : "tag-chk";
  if (id) input.id = id;
  if (name) input.name = name;
  input.checked = Boolean(checked);
  input.indeterminate = Boolean(indeterminate);
  input.disabled = Boolean(disabled);
  if (ariaLabel) input.setAttribute("aria-label", ariaLabel);
  if (tooltip) input.setAttribute("data-tooltip", tooltip);
  if (tooltipDelay)
    input.setAttribute("data-tooltip-delay", String(tooltipDelay));
  if (dataset) {
    for (const [k, v] of Object.entries(dataset)) {
      input.dataset[k] = v;
    }
  }
  if (onChange) {
    input.addEventListener("change", onChange, signal ? { signal } : undefined);
  }
  return input;
}

export function syncTriStateCheckbox(input, selectedCount, totalCount) {
  if (!input) return;
  input.disabled = totalCount === 0;
  input.checked = totalCount > 0 && selectedCount === totalCount;
  input.indeterminate = selectedCount > 0 && selectedCount < totalCount;
}
