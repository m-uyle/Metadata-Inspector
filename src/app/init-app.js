import { mountInspectorPage } from "../pages/inspector/index.js";

export const initApp = () => {
  const root = document.querySelector("#app");
  if (!root) {
    throw new Error("Missing #app mount container");
  }
  return mountInspectorPage(root);
};
