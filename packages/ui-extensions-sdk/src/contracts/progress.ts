import { z } from "zod";

import type { RemoteEvents } from "./events";

export const TAG = "tangent-progress" as const;

const TONE = ["default", "info", "success", "warning", "critical"] as const;

export const attributes = z.object({
  value: z.number().optional().catch(undefined),
  tone: z.enum(TONE).optional().catch(undefined),
});

export const events: RemoteEvents = {};
