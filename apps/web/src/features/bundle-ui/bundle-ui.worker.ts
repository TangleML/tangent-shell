/**
 * Bundle-UI sandbox worker (Phase 5).
 *
 * Runs a compiled bundle component against a remote-dom DOM polyfill and streams
 * the resulting tree of vocabulary elements to the host over `@quilted/threads`.
 * The component reaches the outside world only through the host bridge exposed
 * as `@tangent/ui-extensions-sdk`.
 *
 * The polyfill imports MUST stay first: importing `./runtime/bridge` registers
 * custom elements, which requires `customElements` to already exist.
 */

import "@remote-dom/core/polyfill";
import "@remote-dom/react/polyfill";

import { ThreadWebWorker } from "@quilted/threads";
import type { RemoteConnection } from "@remote-dom/core/elements";
import { RemoteRootElement } from "@remote-dom/core/elements";
import * as React from "react";
import { type ComponentType, createElement } from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";

import * as BundleUiRuntime from "./runtime/bridge";
import {
  loadComponent,
  registerWorkerModules,
} from "./runtime/workerModuleLoader";
import type { HostBridge, RenderOptions, WorkerApi } from "./types";

// Expose the worker's own module instances so the loader's blob shims can
// re-export them to the (externalized) compiled component.
registerWorkerModules({
  react: React as unknown as Record<string, unknown>,
  "react/jsx-runtime": ReactJsxRuntime as unknown as Record<string, unknown>,
  "@tangent/ui-extensions-sdk": BundleUiRuntime as unknown as Record<
    string,
    unknown
  >,
  // Legacy alias: bundles compiled before the SDK rename still import
  // `@tangent/bundle-ui`. Resolve it to the same runtime so they keep working.
  "@tangent/bundle-ui": BundleUiRuntime as unknown as Record<string, unknown>,
});

async function render(
  connection: unknown,
  options: RenderOptions,
): Promise<void> {
  // The host functions become this worker's bridge; the component reaches them
  // via `@tangent/ui-extensions-sdk`'s `host`.
  globalThis.__TANGENT_BUNDLE_UI_HOST__ = thread.imports as HostBridge;

  const Component = await loadComponent(options.moduleUrl);

  // Workers have no usable `MutationObserver`, so we stream through a
  // `RemoteRootElement` (the canonical remote-dom worker path): React renders
  // into it, and `connect()` forwards the tree to the host receiver.
  if (!customElements.get("remote-root")) {
    customElements.define("remote-root", RemoteRootElement);
  }
  const root = document.createElement("remote-root") as RemoteRootElement;
  root.connect(connection as RemoteConnection);
  document.body.appendChild(root);

  createRoot(root).render(
    createElement(Component as ComponentType<Record<string, never>>),
  );
}

const thread = ThreadWebWorker.self<HostBridge, WorkerApi>({
  exports: { render },
});
