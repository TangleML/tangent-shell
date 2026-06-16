/**
 * The props a host adapter receives from `RemoteRootRenderer` for one remote
 * element: the serialized remote attributes, the rendered children, and (with no
 * `eventProps` on the host side) each remote event surfaced as an `on<Event>`
 * callback. Values are `unknown` because they cross the worker boundary; each
 * adapter validates them with its zod schema and narrows event callbacks with a
 * `typeof === "function"` guard.
 */

import type { ReactNode } from "react";

export interface RemoteProps {
  children?: ReactNode;
  [key: string]: unknown;
}
