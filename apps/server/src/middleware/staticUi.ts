import { existsSync } from "node:fs";
import path from "node:path";

import express, { type Express } from "express";

import { WEB_DIST_DIR } from "../config.ts";

/**
 * Serves the built static UI and an SPA history fallback from the same app that
 * handles /api and Socket.IO, so the combined image needs no reverse proxy.
 * No-op in dev (WEB_DIST_DIR unset), where Vite serves the UI and proxies /api +
 * /socket.io here.
 *
 * Mount last, after every API/internal router: `express.static` only matches
 * real build files, and the fallback returns index.html for any other GET so
 * client-side routing can take over — while letting unknown /api and /internal
 * paths fall through to the normal 404. Socket.IO intercepts /socket.io before
 * Express, so it needs no handling here.
 */
export function serveStaticUi(app: Express): void {
  if (!WEB_DIST_DIR) return;
  if (!existsSync(WEB_DIST_DIR)) {
    console.warn(`[server] WEB_DIST_DIR ${WEB_DIST_DIR} not found; UI not served`);
    return;
  }

  const indexHtml = path.join(WEB_DIST_DIR, "index.html");
  app.use(express.static(WEB_DIST_DIR));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api") || req.path.startsWith("/internal")) {
      return next();
    }
    res.sendFile(indexHtml);
  });
}
