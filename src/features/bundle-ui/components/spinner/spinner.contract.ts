import { z } from "zod";

import type { RemoteEvents } from "../_shared/events";

export const TAG = "tangent-spinner" as const;

export const attributes = z.object({
  size: z.number().optional().catch(undefined),
});

export const events: RemoteEvents = {};
