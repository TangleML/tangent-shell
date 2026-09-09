// Embed-only variant (aliased in `apps/web/vite.embed.config.ts`). The
// `?worker&inline` suffix bundles the worker as a base64 blob so the embed
// runtime stays a single self-contained file.
import BundleUiWorker from "./bundle-ui.worker.ts?worker&inline";

/** Boots the bundle-UI sandbox worker from an inlined blob. */
export function createBundleUiWorker(): Worker {
  return new BundleUiWorker();
}
