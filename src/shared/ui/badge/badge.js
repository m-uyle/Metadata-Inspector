import { escapeHtml } from "../../lib/index.js";

function resolveBadgeClasses(variant, className) {
  const isPill = variant === "pill";
  const classes = [isPill ? "meta-pill" : "badge"];
  if (variant === "primary") classes.push("badge--primary");
  else if (variant === "subtle") classes.push("badge--subtle");
  else if (variant === "danger") classes.push("badge--danger");
  if (className) classes.push(className);
  return classes.join(" ");
}

export function createBadge({
  text = "",
  variant = "badge",
  className = "",
} = {}) {
  const el = document.createElement("span");
  el.className = resolveBadgeClasses(variant, className);
  el.textContent = String(text);
  return el;
}

export function badgeHtml(text, variant = "badge", className = "") {
  return `<span class="${resolveBadgeClasses(variant, className)}">${escapeHtml(text)}</span>`;
}
