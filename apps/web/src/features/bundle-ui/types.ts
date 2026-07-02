/**
 * Bundle-UI host/worker types.
 *
 * The bridge contract (`HostBridge` and friends) is owned by
 * `@tangent/ui-extensions-sdk` so authors and the runtime share one source of
 * truth; it is re-exported here for the host/worker code. The worker plumbing
 * types (`RenderOptions`, `WorkerApi`) are internal to the web app and stay here.
 */

import type { BundleUiKind } from "@tangent/ui-extensions-sdk/types";

export type {
  BundleUiKind,
  HostBridge,
  HostFetchInput,
  HostRequestInit,
  HostResponse,
  HostTargetRequest,
  UICommand,
} from "@tangent/ui-extensions-sdk/types";

/** Arguments the host passes to the worker's `render` export. */
export interface RenderOptions {
  /** URL of the compiled component JS to import (the Phase-3 asset). */
  moduleUrl: string;
  /** Component kind, surfaced to the component if it needs it. */
  kind: BundleUiKind;
}

/** The methods the worker exposes back to the host. */
export interface WorkerApi {
  render(connection: unknown, options: RenderOptions): Promise<void>;
}
