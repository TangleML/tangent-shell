import { z } from "zod";

import type { RemoteEvents } from "../_shared/events";

export const TAG = "tangent-card" as const;

const DENSITY = ["compact", "cozy", "comfortable"] as const;

export const attributes = z.object({
  density: z.enum(DENSITY).optional().catch(undefined),
});

export const events: RemoteEvents = {};
