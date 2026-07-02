import { z } from "zod";

import type { RemoteEvents } from "./events";

export const TAG = "tangent-card-header" as const;

const DENSITY = ["compact", "cozy", "comfortable"] as const;

export const attributes = z.object({
  density: z.enum(DENSITY).optional().catch(undefined),
  divider: z.boolean().optional().catch(undefined),
});

export const events: RemoteEvents = {};
