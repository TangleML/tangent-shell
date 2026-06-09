/**
 * Worker helper: register a remote custom element for a component from its zod
 * `attributes` schema (wire `{ type }` map derived by `wireProperties`) and its
 * `events`. Idempotent so HMR / double-imports don't throw on re-registration.
 *
 * Touches `customElements`, so it must only run in the worker, after the
 * remote-dom DOM polyfill has installed the globals.
 */

import {
  createRemoteElement,
  type RemoteElementConstructor,
} from "@remote-dom/core/elements";
import type { z } from "zod";

import type { RemoteEvents } from "./events";
import { wireProperties } from "./wire-properties";

export type AnyRemoteElementConstructor = RemoteElementConstructor<
  Record<string, unknown>,
  Record<string, never>,
  Record<string, never>,
  Record<string, unknown>
>;

export function defineRemoteElement(
  tag: string,
  attributes: z.ZodObject,
  events: RemoteEvents,
): AnyRemoteElementConstructor {
  const eventDefs: Record<string, Record<string, never>> = {};
  for (const name of Object.keys(events)) eventDefs[name] = {};

  const ElementClass = createRemoteElement({
    properties: wireProperties(attributes),
    events: eventDefs,
  }) as AnyRemoteElementConstructor;

  if (!customElements.get(tag)) {
    customElements.define(
      tag,
      ElementClass as unknown as CustomElementConstructor,
    );
  }
  return (
    (customElements.get(tag) as unknown as AnyRemoteElementConstructor) ??
    ElementClass
  );
}
