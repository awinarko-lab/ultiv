import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react" }), tailwindcss(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Tailnet-visible by default (set HOST to narrow); /api and /chord proxy to
  // the chord server so any device that reaches the dev server can use the app.
  server: {
    host: process.env.HOST ?? true,
    // MagicDNS names (*.ts.net) reach this server across the tailnet; IPs are
    // exempt from the check by Vite, names are not.
    allowedHosts: [".ts.net"],
    proxy: {
      "/api": { target: backend() },
      "/chord": { target: backend().replace(/^http/, "ws"), ws: true },
    },
  },
});

function backend(): string {
  return `http://127.0.0.1:${process.env.PORT ?? 8787}`;
}
