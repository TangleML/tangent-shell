/**
 * Worker helper: build the author-facing React wrapper for a remote element from
 * its `events` contract. It wraps `createRemoteComponent` (registering each
 * event under its author handler prop) and normalizes each event so the author's
 * handler receives a plain serializable payload (`value` -> string, `checked` ->
 * boolean, `none` -> no args) instead of a raw `RemoteEvent`.
 */

import { createRemoteComponent } from "@remote-dom/react";
import { type ComponentType, createElement, type ReactNode } from "react";

import type { AnyRemoteElementConstructor } from "./define-remote-element";
import type { EventPayload, RemoteEvents } from "./events";

type AnyProps = Record<string, unknown>;
type Handler = (...args: unknown[]) => void;

function decode(payload: EventPayload, handler: Handler) {
  return (event: unknown) => {
    const detail = (event as { detail?: unknown } | null)?.detail;
    if (payload === "value") {
      handler(typeof detail === "string" ? detail : String(detail ?? ""));
    } else if (payload === "checked") {
      handler(Boolean(detail));
    } else {
      handler();
    }
  };
}

export function makeAuthorComponent(
  tag: string,
  Element: AnyRemoteElementConstructor,
  events: RemoteEvents,
): ComponentType<AnyProps> {
  const eventProps: Record<string, { event: string }> = {};
  for (const [name, def] of Object.entries(events)) {
    eventProps[def.handlerProp] = { event: name };
  }
  const hasEvents = Object.keys(eventProps).length > 0;

  // Our tags are custom elements, not in `HTMLElementTagNameMap`; the loose casts
  // are confined to this generic adapter (worker-only, never the host mapping).
  const Raw = createRemoteComponent(
    tag as keyof HTMLElementTagNameMap,
    Element as never,
    hasEvents ? { eventProps } : undefined,
  ) as unknown as ComponentType<AnyProps>;

  if (!hasEvents) {
    function Author(props: AnyProps): ReactNode {
      return createElement(Raw, props);
    }
    Author.displayName = `Author(${tag})`;
    return Author;
  }

  function Author(props: AnyProps): ReactNode {
    const next: AnyProps = { ...props };
    for (const [, def] of Object.entries(events)) {
      const handler = props[def.handlerProp];
      if (typeof handler === "function") {
        next[def.handlerProp] = decode(def.payload, handler as Handler);
      }
    }
    return createElement(Raw, next);
  }
  Author.displayName = `Author(${tag})`;
  return Author;
}
