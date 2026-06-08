/**
 * Worker-side remote element definitions, derived from the Phase-4 vocabulary.
 *
 * For every element in `BUNDLE_UI_ELEMENTS` this registers a `RemoteElement`
 * subclass whose remote *properties* mirror the vocabulary attributes (so values
 * keep their JS type across the wire) and whose remote *events* mirror the
 * declared events. The constructors are reused by `bridge.tsx` to build the
 * React wrapper components authors render.
 *
 * This module touches `customElements` and must therefore only be evaluated in
 * the worker, after the remote-dom DOM polyfill has installed the globals.
 */

import {
  createRemoteElement,
  type RemoteElementConstructor,
} from "@remote-dom/core/elements";

import {
  type AttributeKind,
  BUNDLE_UI_ELEMENTS,
  type BundleUiElementName,
} from "../vocabulary";

/** Maps a vocabulary attribute kind to the remote property's JS constructor. */
function constructorForKind(kind: AttributeKind): typeof String | typeof Number | typeof Boolean {
  switch (kind) {
    case "number":
      return Number;
    case "boolean":
      return Boolean;
    // enum + string both travel as strings.
    case "enum":
    case "string":
      return String;
  }
}

type AnyRemoteElementConstructor = RemoteElementConstructor<
  Record<string, unknown>,
  Record<string, never>,
  Record<string, never>,
  Record<string, unknown>
>;

function defineElement(name: BundleUiElementName): AnyRemoteElementConstructor {
  const spec = BUNDLE_UI_ELEMENTS[name];

  const properties: Record<string, { type: typeof String | typeof Number | typeof Boolean }> = {};
  for (const [attr, attrSpec] of Object.entries(spec.attributes)) {
    properties[attr] = { type: constructorForKind(attrSpec.kind) };
  }

  const events: Record<string, Record<string, never>> = {};
  for (const event of spec.events) events[event] = {};

  const ElementClass = createRemoteElement({
    properties,
    events,
  }) as AnyRemoteElementConstructor;

  // Idempotent so HMR / double-imports don't throw on re-registration.
  if (!customElements.get(name)) {
    customElements.define(name, ElementClass as unknown as CustomElementConstructor);
  }
  return (customElements.get(name) as unknown as AnyRemoteElementConstructor) ?? ElementClass;
}

/** Every vocabulary element's registered remote constructor, keyed by tag. */
export const bundleUiElementConstructors = Object.fromEntries(
  (Object.keys(BUNDLE_UI_ELEMENTS) as BundleUiElementName[]).map((name) => [
    name,
    defineElement(name),
  ]),
) as Record<BundleUiElementName, AnyRemoteElementConstructor>;
