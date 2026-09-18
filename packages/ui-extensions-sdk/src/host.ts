/**
 * The allowlisted host bridge a UI extension talks to.
 *
 * At runtime the worker injects the real implementation onto `globalThis` and
 * swaps this module for its own runtime copy, so the body here exists mainly to
 * give authors a typed, importable `host`. See `docs/bundle-ui/host-bridge.md`.
 */

import type {
  HostBridge,
  HostFetchInput,
  HostRequestInit,
  UICommand,
} from "./types";

declare global {
  var __TANGENT_BUNDLE_UI_HOST__: HostBridge | undefined;
}

function bridge(): HostBridge {
  const current = globalThis.__TANGENT_BUNDLE_UI_HOST__;
  if (!current) {
    throw new Error(
      "@tangent/ui-extensions-sdk: host bridge is not available yet",
    );
  }
  return current;
}

/** The allowlisted host bridge. See `docs/bundle-ui/host-bridge.md`. */
export const host: HostBridge = {
  getProps: () => bridge().getProps(),
  sendPrompt: (text: string) => bridge().sendPrompt(text),
  fetch: (input: HostFetchInput, init?: HostRequestInit) =>
    bridge().fetch(input, init),
  getState: (key: string) => bridge().getState(key),
  setState: (key: string, value: unknown) => bridge().setState(key, value),
  execUICommand: (command: UICommand) => bridge().execUICommand(command),
};
