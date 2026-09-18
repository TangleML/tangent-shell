/**
 * Boots the bundle-UI sandbox worker from its module URL — the app default.
 *
 * The embed build aliases this module to `createBundleUiWorker.embed.ts`, which
 * inlines the worker so the runtime stays a single self-contained file (the lib
 * build cannot emit a separate worker chunk). See `apps/web/vite.embed.config.ts`.
 */
export function createBundleUiWorker(): Worker {
  return new Worker(new URL("./bundle-ui.worker.ts", import.meta.url), {
    type: "module",
  });
}
