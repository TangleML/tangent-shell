import type { ReactNode } from "react";

import { StatusBar, type StatusStats } from "@/shared/ui/patterns/status-bar";

import type { RemoteProps } from "../_shared/remote-props";

/**
 * Host adapter for `tangent-status-bar`. The `segments` attribute crosses the
 * worker boundary as a JSON string of a `{ STATUS: count }` map, so this adapter
 * parses and validates it (rather than using `makeHostComponent`, whose schema
 * output must be assignable to the primitive's props). Anything malformed
 * degrades to an empty bar.
 */

function parseStats(value: unknown): StatusStats | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const stats: StatusStats = {};
    for (const [status, count] of Object.entries(parsed)) {
      if (typeof count === "number" && Number.isFinite(count)) {
        stats[status] = count;
      }
    }
    return stats;
  } catch {
    return null;
  }
}

export function StatusBarHost(props: RemoteProps): ReactNode {
  return <StatusBar stats={parseStats(props.segments)} />;
}

StatusBarHost.displayName = "Host(StatusBar)";
