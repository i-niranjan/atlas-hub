import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vite";

// In a plain browser (dev only) there is no Tauri bridge to read the daemon
// token, so inject it at dev-server time. Production builds never embed it.
function devToken(): string {
  const path = join(homedir(), "Library", "Application Support", "Atlas", "token");
  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  define: {
    __ATLAS_DEV_TOKEN__: JSON.stringify(command === "serve" ? devToken() : ""),
  },
  server: { port: 1420, strictPort: true },
  build: { target: "safari16", chunkSizeWarningLimit: 4000 },
}));
