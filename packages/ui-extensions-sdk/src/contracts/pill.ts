import { z } from "zod";

import type { RemoteEvents } from "./events";

export const TAG = "tangent-pill" as const;

const TONE = [
  "default",
  "subdued",
  "critical",
  "warning",
  "info",
  "success",
  "magic",
] as const;
const SIZE = ["xs", "sm", "md"] as const;

export const attributes = z.object({
  tone: z.enum(TONE).optional().catch(undefined),
  size: z.enum(SIZE).optional().catch(undefined),
});

export const events: RemoteEvents = {};
