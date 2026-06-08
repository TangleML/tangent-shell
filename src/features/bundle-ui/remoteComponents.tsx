/**
 * Host-side component map for `RemoteRootRenderer`.
 *
 * Turns each remote element name into a React renderer that draws the real
 * Tangle primitive, reusing the Phase-4 `hostComponentMap` for attribute
 * translation and event mapping. `createRemoteComponentRenderer` subscribes the
 * wrapper to the remote element's property/child changes; our inner component
 * then validates the incoming props (`mapProps`) and rewires each remote event
 * (surfaced as an `on<Event>` callback) to the primitive's handler prop.
 */

import type {
  RemoteComponentRendererMap,
  RemoteComponentRendererProps,
} from "@remote-dom/react/host";
import {
  createRemoteComponentRenderer,
  RemoteFragmentRenderer,
} from "@remote-dom/react/host";
import type { ComponentType, ReactNode } from "react";
import { createElement } from "react";

import { hostComponentMap } from "./hostComponentMap";
import { BUNDLE_UI_ELEMENT_NAMES, type BundleUiElementName } from "./vocabulary";

type AnyProps = Record<string, unknown>;

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function makeRenderer(
  name: BundleUiElementName,
): ComponentType<RemoteComponentRendererProps> {
  const def = hostComponentMap[name];
  const Primitive = def.component;

  function HostElement(props: AnyProps): ReactNode {
    const { children } = props as { children?: ReactNode };
    const mapped = def.mapProps(props);

    // Each remote event arrives as a wrapped `on<Event>` callback. Translate it
    // into the primitive's handler prop, extracting a serializable payload.
    for (const [eventName, eventDef] of Object.entries(def.events)) {
      const remoteCallback = props[`on${capitalize(eventName)}`];
      if (typeof remoteCallback === "function") {
        const callback = remoteCallback as (payload?: unknown) => void;
        mapped[eventDef.prop] = (event: unknown) => {
          callback(eventDef.extract ? eventDef.extract(event) : undefined);
        };
      }
    }

    return createElement(Primitive, mapped, children);
  }
  HostElement.displayName = `HostElement(${name})`;

  return createRemoteComponentRenderer(HostElement);
}

/**
 * The map handed to `RemoteRootRenderer`: every vocabulary element plus the
 * `remote-fragment` wrapper remote-dom uses for slotted React props.
 */
export const remoteComponents: RemoteComponentRendererMap = new Map([
  ...BUNDLE_UI_ELEMENT_NAMES.map(
    (name) => [name, makeRenderer(name)] as const,
  ),
  ["remote-fragment", RemoteFragmentRenderer],
]);
