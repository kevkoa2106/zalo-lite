import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;

// Tauri expects a fixed dev port and serves the built `dist` in release.
export default defineConfig({
  plugins: [preact()],
  define: { __APP_VERSION__: JSON.stringify(version) }, // shown in the gear menu, Hỗ trợ
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "safari16", outDir: "dist" },
});
