import { z } from "zod";

import type { RemoteEvents } from "./events";

export const TAG = "tangent-score-ring" as const;

// `score` is required by the primitive; `.catch(0)` keeps it non-optional.
export const attributes = z.object({
  score: z.number().catch(0),
  size: z.number().optional().catch(undefined),
});

export const events: RemoteEvents = {};
