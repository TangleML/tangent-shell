import { z } from "zod";

import type { RemoteEvents } from "../_shared/events";

export const TAG = "tangent-status-bar" as const;

// `segments` is a JSON string of a `{ STATUS: count }` map. Complex data must
// cross the worker boundary as a string (see `wireProperties`); the host adapter
// parses it back into an object.
export const attributes = z.object({
  segments: z.string().optional().catch(undefined),
});

export const events: RemoteEvents = {};
