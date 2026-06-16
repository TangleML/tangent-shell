/**
 * Host HOC that turns a Tangle primitive + its zod `attributes` schema into a
 * cast-free remote-element adapter. The closure keeps the primitive's concrete
 * props type `P` alive (the same technique `createRemoteComponentRenderer` uses
 * internally), and the `A extends P` constraint makes the schema's inferred
 * output the compile-time sync gate against the primitive's real props.
 *
 * No `as` casts: `A extends P` makes the parsed attributes assignable to `P`, and
 * the optional `wire` callback handles event / extra-prop wiring with full types.
 */

import { type ComponentType, createElement, type ReactNode } from "react";
import type { z } from "zod";

import type { RemoteProps } from "./remote-props";

export function makeHostComponent<P, A extends P>(
  Component: ComponentType<P>,
  schema: z.ZodType<A>,
  /** Optional, fully-typed event / extra-prop wiring (host + primitive specific). */
  wire?: (props: RemoteProps) => Partial<P>,
): ComponentType<RemoteProps> {
  function Host(props: RemoteProps): ReactNode {
    // Invalid attrs become their `catch` value (usually undefined); unknown keys
    // (children, on<Event>) are stripped, so the primitive uses its defaults.
    const parsed = schema.parse(props);
    const wired = wire?.(props);
    return createElement(Component, { ...parsed, ...wired }, props.children);
  }
  Host.displayName = `Host(${Component.displayName ?? Component.name})`;
  return Host;
}
