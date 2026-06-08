/* eslint-disable react-refresh/only-export-components -- worker-only runtime module that intentionally exports the `host` bridge and element wrappers together; never hot-reloaded on the host. */

/**
 * `@tangent/bundle-ui` — the module a sandboxed bundle component imports.
 *
 * It exposes:
 *  - `host`: the allowlisted bridge (`getProps` / `sendPrompt` / `fetch`), which
 *    delegates to the host functions the worker wired onto `globalThis` over
 *    `@quilted/threads`.
 *  - one React wrapper component per vocabulary element, so authors render
 *    type-friendly components (`<Button onPress={...}>`) instead of raw custom
 *    elements. Events are normalized to plain serializable callbacks.
 *
 * This module is evaluated **only in the worker** (it registers custom elements
 * via `./elements`). On the host it exists solely as a type/alias target.
 */

import { createRemoteComponent } from "@remote-dom/react";
import {
  type ComponentType,
  createElement,
  type ReactNode,
} from "react";

import type { HostBridge, HostRequestInit, HostResponse } from "../types";
import { bundleUiElementConstructors } from "./elements";

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
};

export type { HostRequestInit, HostResponse };

type AnyProps = Record<string, unknown>;
type AnyComponent = ComponentType<AnyProps>;

/**
 * Wraps `createRemoteComponent` with a loose tag type (our tags are custom
 * elements, not in `HTMLElementTagNameMap`) and a stable prop signature.
 */
function remoteComponent(
  tag: string,
  eventProps?: Record<string, { event: string }>,
): AnyComponent {
  return createRemoteComponent(
    tag as keyof HTMLElementTagNameMap,
    bundleUiElementConstructors[tag as keyof typeof bundleUiElementConstructors] as never,
    eventProps ? { eventProps } : undefined,
  ) as unknown as AnyComponent;
}

const RawBlockStack = remoteComponent("tangent-block-stack");
const RawInlineStack = remoteComponent("tangent-inline-stack");
const RawText = remoteComponent("tangent-text");
const RawHeading = remoteComponent("tangent-heading");
const RawButton = remoteComponent("tangent-button", { onPress: { event: "press" } });
const RawIcon = remoteComponent("tangent-icon");
const RawTextarea = remoteComponent("tangent-textarea", { onInput: { event: "input" } });
const RawSpinner = remoteComponent("tangent-spinner");
const RawCard = remoteComponent("tangent-card");
const RawPill = remoteComponent("tangent-pill");
const RawProgress = remoteComponent("tangent-progress");
const RawScoreRing = remoteComponent("tangent-score-ring");
const RawCheckbox = remoteComponent("tangent-checkbox", {
  onChange: { event: "change" },
});

export function BlockStack(props: AnyProps): ReactNode {
  return createElement(RawBlockStack, props);
}
export function InlineStack(props: AnyProps): ReactNode {
  return createElement(RawInlineStack, props);
}
export function Text(props: AnyProps): ReactNode {
  return createElement(RawText, props);
}
export function Heading(props: AnyProps): ReactNode {
  return createElement(RawHeading, props);
}
export function Icon(props: AnyProps): ReactNode {
  return createElement(RawIcon, props);
}
export function Spinner(props: AnyProps): ReactNode {
  return createElement(RawSpinner, props);
}
export function Card(props: AnyProps): ReactNode {
  return createElement(RawCard, props);
}
export function Pill(props: AnyProps): ReactNode {
  return createElement(RawPill, props);
}
export function Progress(props: AnyProps): ReactNode {
  return createElement(RawProgress, props);
}
export function ScoreRing(props: AnyProps): ReactNode {
  return createElement(RawScoreRing, props);
}

/** `press` carries no payload; the author's handler is called with no args. */
export function Button(props: AnyProps): ReactNode {
  return createElement(RawButton, props);
}

/**
 * `tangent-textarea` emits an `input` event carrying the new value. We normalize
 * it so the author's `onInput` receives the string directly rather than a
 * `RemoteEvent`.
 */
export function Textarea(props: AnyProps): ReactNode {
  const { onInput, ...rest } = props as {
    onInput?: (value: string) => void;
  } & AnyProps;
  const onRawInput =
    typeof onInput === "function"
      ? (event: unknown) => {
          const detail = (event as { detail?: unknown } | null)?.detail;
          onInput(typeof detail === "string" ? detail : String(detail ?? ""));
        }
      : undefined;
  return createElement(RawTextarea, { ...rest, onInput: onRawInput });
}

/**
 * `tangent-checkbox` emits a `change` event carrying the new checked value. We
 * normalize it so the author's `onCheckedChange` receives the boolean directly
 * rather than a `RemoteEvent`.
 */
export function Checkbox(props: AnyProps): ReactNode {
  const { onCheckedChange, ...rest } = props as {
    onCheckedChange?: (checked: boolean) => void;
  } & AnyProps;
  const onChange =
    typeof onCheckedChange === "function"
      ? (event: unknown) => {
          const detail = (event as { detail?: unknown } | null)?.detail;
          onCheckedChange(Boolean(detail));
        }
      : undefined;
  return createElement(RawCheckbox, { ...rest, onChange });
}
