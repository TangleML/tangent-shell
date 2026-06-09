/**
 * Derive the remote-dom wire `{ type }` map from a component's zod `attributes`
 * schema, so the schema is the single attribute declaration (no hand-written
 * `remoteProperties`). `createRemoteElement` needs each attribute's JS
 * constructor (`String`/`Number`/`Boolean`); we recover it by walking the zod
 * object's `shape` and unwrapping each field's def chain.
 *
 * Trade-off: this reads zod v4's semi-internal `_zod.def` (verified against
 * zod 4.4.3: `catch`/`optional`/`default`/`nullable`/`readonly`/`nonoptional`/
 * `prefault` wrap an `innerType`; `number` -> `Number`, `boolean` -> `Boolean`,
 * and everything else — `enum`/`string`/`literal`/`union`/`pipe`/`custom` —
 * travels as `String`, matching the old `constructorForKind`). It is isolated to
 * this one helper and covered by a unit test so a zod upgrade fails loudly here.
 */

import type { z } from "zod";

type WireCtor = StringConstructor | NumberConstructor | BooleanConstructor;

/** Minimal view of a zod def node, including the wrapper `innerType` link. */
interface DefNode {
  type: string;
  innerType?: { _zod: { def: DefNode } };
}

/** def-`type`s that wrap an `innerType` we should unwrap to find the base type. */
const WRAPPERS = new Set([
  "catch",
  "optional",
  "default",
  "nullable",
  "readonly",
  "nonoptional",
  "prefault",
]);

/** Walk the def chain to the innermost (non-wrapper) zod type name. */
function baseType(def: DefNode): string {
  if (WRAPPERS.has(def.type) && def.innerType) {
    return baseType(def.innerType._zod.def);
  }
  return def.type;
}

function defOf(field: unknown): DefNode {
  return (field as { _zod: { def: DefNode } })._zod.def;
}

/** Map each attribute to its remote-dom wire constructor `{ type }`. */
export function wireProperties(
  schema: z.ZodObject,
): Record<string, { type: WireCtor }> {
  const out: Record<string, { type: WireCtor }> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const t = baseType(defOf(field));
    out[key] = {
      type: t === "number" ? Number : t === "boolean" ? Boolean : String,
    };
  }
  return out;
}
