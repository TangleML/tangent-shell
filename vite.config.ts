import path from "node:path";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Backend the dev server proxies /api and /socket.io to. Override via the
// API_TARGET env var to point the local UI at a remote agent (e.g. the Cloud
// Run proxy on http://localhost:8788) without touching client fetch/socket code.
const apiTarget = process.env.API_TARGET ?? "http://localhost:8787";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // React Compiler runs as a Babel preset. @vitejs/plugin-react@6 dropped
    // inline Babel, so it is wired in through @rolldown/plugin-babel. The babel
    // step must run before react() so the compiler sees source JSX, not the
    // already-transformed output of react()'s oxc transform.
    babel({ presets: [reactCompilerPreset()] }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  server: {
    allowedHosts: [".tunnel.shopifycloud.tech"],
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/socket.io": {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
