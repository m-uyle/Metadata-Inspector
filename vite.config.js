import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    open: true,
  },
  optimizeDeps: {
    // Keep WASM asset URL resolution intact inside @uswriting/exiftool
    exclude: ["@uswriting/exiftool"],
  },
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
