import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  root: resolve(import.meta.dirname, "web"),
  base: "/",
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, "public"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        miniapp: resolve(import.meta.dirname, "web/index.html"),
        admin: resolve(import.meta.dirname, "web/admin/index.html"),
      },
    },
  },
  server: {
    proxy: {
      "/api": backend,
      "/admin/api": backend,
    },
  },
});
