export function createInput({
  id,
  name,
  type = "text",
  value = "",
  placeholder = "",
  size = "md",
  disabled = false,
  autocomplete,
  spellcheck,
  step,
  min,
  max,
  ariaLabel,
  tooltip,
  className = "",
  onInput,
  onBlur,
  signal,
} = {}) {
  const input = document.createElement("input");
  input.type = type;
  const classes = ["input"];
  if (size === "sm") classes.push("input-sm");
  if (className) classes.push(className);
  input.className = classes.join(" ");

  if (id) input.id = id;
  if (name) input.name = name;
  if (value !== undefined) input.value = String(value);
  if (placeholder) input.placeholder = placeholder;
  input.disabled = Boolean(disabled);
  if (autocomplete !== undefined) input.autocomplete = autocomplete;
  if (spellcheck !== undefined) input.spellcheck = Boolean(spellcheck);
  if (step !== undefined) input.step = String(step);
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  if (ariaLabel) input.setAttribute("aria-label", ariaLabel);
  if (tooltip) input.setAttribute("data-tooltip", tooltip);

  const opts = signal ? { signal } : undefined;
  if (onInput) input.addEventListener("input", onInput, opts);
  if (onBlur) input.addEventListener("blur", onBlur, opts);
  return input;
}

export function setInputError(input, errEl, message, { focus = true } = {}) {
  if (errEl) {
    errEl.textContent = message;
    errEl.classList.remove("hidden");
  }
  if (input) {
    input.setAttribute("aria-invalid", "true");
    if (focus) input.focus();
  }
}

export function clearInputError(inputs, errEl) {
  if (errEl) {
    errEl.textContent = "";
    errEl.classList.add("hidden");
  }
  const list = Array.isArray(inputs) ? inputs : inputs ? [inputs] : [];
  for (const inp of list) {
    if (inp) inp.removeAttribute("aria-invalid");
  }
}

export function bindInputKeys(
  input,
  { onEnter, onEscape } = {},
  signal = null
) {
  if (!input) return;
  input.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter" && onEnter) {
        e.preventDefault();
        onEnter(e);
      } else if (e.key === "Escape" && onEscape) {
        e.preventDefault();
        onEscape(e);
      }
    },
    signal ? { signal } : undefined
  );
}
