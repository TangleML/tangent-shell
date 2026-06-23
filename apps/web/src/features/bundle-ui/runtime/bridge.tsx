/* eslint-disable react-refresh/only-export-components -- worker-only runtime barrel that intentionally exports the `host` bridge alongside the element wrappers; never hot-reloaded on the host. */

/**
 * `@tangent/bundle-ui` — the module a sandboxed bundle component imports.
 *
 * It is a barrel that exposes:
 *  - `host`: the allowlisted bridge (`getProps` / `sendPrompt` / `fetch`), which
 *    delegates to the host functions the worker wired onto `globalThis` over
 *    `@quilted/threads`.
 *  - one React wrapper component per element, re-exported from each component's
 *    `*.remote` module. Importing those modules registers their custom elements
 *    as a side effect, so this module is evaluated **only in the worker** (on the
 *    host it exists solely as a type/alias target).
 */

import type {
  HostBridge,
  HostRequestInit,
  HostResponse,
  UICommand,
} from "../types";

declare global {
  var __TANGENT_BUNDLE_UI_HOST__: HostBridge | undefined;
}

function bridge(): HostBridge {
  const current = globalThis.__TANGENT_BUNDLE_UI_HOST__;
  if (!current) {
    throw new Error("@tangent/bundle-ui: host bridge is not available yet");
  }
  return current;
}

/** The allowlisted host bridge. See `docs/bundle-ui/host-bridge.md`. */
export const host: HostBridge = {
  getProps: () => bridge().getProps(),
  sendPrompt: (text: string) => bridge().sendPrompt(text),
  fetch: (input: string, init?: HostRequestInit) => bridge().fetch(input, init),
  getState: (key: string) => bridge().getState(key),
  setState: (key: string, value: unknown) => bridge().setState(key, value),
  execUICommand: (command: UICommand) => bridge().execUICommand(command),
};

export type { HostRequestInit, HostResponse, UICommand };

export { Badge } from "../components/badge/badge.remote";
export { BlockStack } from "../components/block-stack/block-stack.remote";
export { Button } from "../components/button/button.remote";
export { Card } from "../components/card/card.remote";
export { CardContent } from "../components/card/card-content.remote";
export { CardDescription } from "../components/card/card-description.remote";
export { CardFooter } from "../components/card/card-footer.remote";
export { CardHeader } from "../components/card/card-header.remote";
export { CardTitle } from "../components/card/card-title.remote";
export { Checkbox } from "../components/checkbox/checkbox.remote";
export { Heading } from "../components/heading/heading.remote";
export { Icon } from "../components/icon/icon.remote";
export { InlineStack } from "../components/inline-stack/inline-stack.remote";
export { Pill } from "../components/pill/pill.remote";
export { Progress } from "../components/progress/progress.remote";
export { ScoreRing } from "../components/score-ring/score-ring.remote";
export { Spinner } from "../components/spinner/spinner.remote";
export { StatusBar } from "../components/status-bar/status-bar.remote";
export { Text } from "../components/text/text.remote";
export { Textarea } from "../components/textarea/textarea.remote";
