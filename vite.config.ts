import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// The dev server binds every interface so a phone on the same network can load
// the client while the responsive layout is being worked on. Tauri picks the
// same port up when it wraps the app.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Rust compiler errors scroll past if Vite wipes the terminal.
  clearScreen: false,
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: {
      // src-tauri/target holds build artefacts that cargo rewrites and locks
      // while compiling. Watching it makes the dev server die with EBUSY the
      // moment a Tauri build touches the DLL, so it stays out of the watcher.
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
