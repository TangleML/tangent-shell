// Dev-only variant (aliased in `apps/web/vite.config.ts` for `serve`). Vite does
// not inline workers in dev, so `?worker&inline` would emit a bare root-relative
// URL that a cross-origin embed host resolves against its own origin. Instead,
// boot from a same-origin blob whose first import is the worker module's
// absolute Shell URL: worker scripts must be same-origin with the page, while
// the blob's absolute import lets every transitive worker import resolve against
// the Shell via CORS (the same mechanism the rest of the embed runtime uses).
import workerUrl from "./bundle-ui.worker.ts?worker&url";

/** Boots the bundle-UI sandbox worker from a same-origin blob bootstrap. */
export function createBundleUiWorker(): Worker {
  const absolute = new URL(workerUrl, import.meta.url).href;
  const blob = new Blob([`import ${JSON.stringify(absolute)};`], {
    type: "text/javascript",
  });
  const objectUrl = URL.createObjectURL(blob);
  const worker = new Worker(objectUrl, { type: "module" });
  worker.addEventListener("error", () => URL.revokeObjectURL(objectUrl));
  return worker;
}
