import { initApp } from "./app/index.js";

initApp();

if (
  "serviceWorker" in navigator &&
  (window.location.protocol === "https:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1")
) {
  const registerSw = () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  };
  if (document.readyState === "complete") {
    registerSw();
  } else {
    window.addEventListener("load", registerSw, { once: true });
  }
}
