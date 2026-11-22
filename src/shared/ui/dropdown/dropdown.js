import { hideTooltip } from "../tooltip/tooltip.js";

let scopeRoot = null;
let controller = null;

function getScope() {
  return scopeRoot || document;
}

export function closeAllDropdowns() {
  for (const other of getScope().querySelectorAll(".ui-dropdown.open")) {
    other.classList.remove("open", "open-up");
    const b = other.querySelector(".ui-dropdown-btn");
    if (b) b.setAttribute("aria-expanded", "false");
  }
}

export function syncAllDropdowns() {
  const root = getScope();
  for (const wrap of root.querySelectorAll(".ui-dropdown[data-dropdown]")) {
    const selectId = wrap.getAttribute("data-dropdown");
    const sel = selectId
      ? root.querySelector(`#${CSS.escape(selectId)}`)
      : null;
    if (!sel) continue;
    const btnEl = wrap.querySelector(".ui-dropdown-btn");
    const labelEl = wrap.querySelector(".ui-dropdown-label");
    const menuEl = wrap.querySelector(".ui-dropdown-menu");
    if (btnEl) {
      btnEl.setAttribute(
        "aria-expanded",
        String(wrap.classList.contains("open"))
      );
    }
    const selectedOpt = sel.options[sel.selectedIndex] || sel.options[0];
    if (labelEl && selectedOpt) labelEl.textContent = selectedOpt.textContent;
    if (menuEl) {
      menuEl.innerHTML = "";
      for (const opt of sel.options) {
        if (opt.disabled) continue;
        const itemBtn = document.createElement("button");
        itemBtn.type = "button";
        itemBtn.className = "ui-dropdown-option";
        itemBtn.setAttribute("role", "option");
        itemBtn.setAttribute("aria-selected", String(opt.value === sel.value));
        itemBtn.textContent = opt.textContent;
        itemBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          sel.value = opt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          wrap.classList.remove("open", "open-up");
          if (btnEl) btnEl.setAttribute("aria-expanded", "false");
          syncAllDropdowns();
        });
        menuEl.appendChild(itemBtn);
      }
    }
  }
}

export function openDropdown(wrap, focusSelected = false) {
  const btn = wrap.querySelector(".ui-dropdown-btn");
  const menu = wrap.querySelector(".ui-dropdown-menu");
  if (!(btn && menu)) return;
  closeAllDropdowns();
  syncAllDropdowns();
  wrap.classList.remove("open-up");
  wrap.classList.add("open");
  btn.setAttribute("aria-expanded", "true");
  const rect = menu.getBoundingClientRect();
  const modalEl = wrap.closest(".modal-dialog");
  const limitBottom = modalEl
    ? modalEl.getBoundingClientRect().bottom - 8
    : window.innerHeight - 12;
  const limitTop = modalEl ? modalEl.getBoundingClientRect().top + 8 : 12;
  if (
    rect.bottom > limitBottom &&
    btn.getBoundingClientRect().top - limitTop > rect.height
  ) {
    wrap.classList.add("open-up");
  }
  if (focusSelected) {
    const target =
      menu.querySelector('[aria-selected="true"]') ||
      menu.querySelector(".ui-dropdown-option");
    if (target) target.focus();
  }
}

export function initDropdowns(root) {
  if (controller) controller.abort();
  controller = new AbortController();
  const { signal } = controller;
  scopeRoot = root;

  for (const wrap of root.querySelectorAll(".ui-dropdown[data-dropdown]")) {
    const btn = wrap.querySelector(".ui-dropdown-btn");
    const menu = wrap.querySelector(".ui-dropdown-menu");
    if (!(btn && menu)) continue;

    btn.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        hideTooltip();
        const wasOpen = wrap.classList.contains("open");
        if (wasOpen) {
          wrap.classList.remove("open", "open-up");
          btn.setAttribute("aria-expanded", "false");
        } else {
          openDropdown(wrap, false);
        }
      },
      { signal }
    );

    btn.addEventListener(
      "keydown",
      (e) => {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          if (!wrap.classList.contains("open")) openDropdown(wrap, true);
        }
      },
      { signal }
    );

    menu.addEventListener(
      "keydown",
      (e) => {
        const opts = Array.from(menu.querySelectorAll(".ui-dropdown-option"));
        if (!opts.length) return;
        const idx = opts.indexOf(document.activeElement);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          opts[(idx + 1) % opts.length].focus();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          opts[(idx - 1 + opts.length) % opts.length].focus();
        } else if (e.key === "Home") {
          e.preventDefault();
          opts[0].focus();
        } else if (e.key === "End") {
          e.preventDefault();
          opts.at(-1)?.focus();
        } else if (e.key === "Escape") {
          e.preventDefault();
          wrap.classList.remove("open", "open-up");
          btn.setAttribute("aria-expanded", "false");
          btn.focus();
        }
      },
      { signal }
    );
  }

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!e.target.closest?.(".ui-dropdown")) closeAllDropdowns();
    },
    { signal }
  );
  document.addEventListener(
    "click",
    (e) => {
      if (!e.target.closest?.(".ui-dropdown")) closeAllDropdowns();
    },
    { signal }
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        hideTooltip();
        const openDd = getScope().querySelector(".ui-dropdown.open");
        if (openDd) {
          e.preventDefault();
          e.stopPropagation();
          const btn = openDd.querySelector(".ui-dropdown-btn");
          closeAllDropdowns();
          if (btn) btn.focus();
        }
      }
    },
    { capture: true, signal }
  );

  syncAllDropdowns();

  return function destroyDropdowns() {
    closeAllDropdowns();
    if (controller) {
      controller.abort();
      controller = null;
    }
    scopeRoot = null;
  };
}
