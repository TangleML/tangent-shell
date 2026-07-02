import { z } from "zod";

import { GAP } from "./enums";
import type { RemoteEvents } from "./events";

export const TAG = "tangent-inline-stack" as const;

const ALIGN = [
  "start",
  "center",
  "end",
  "space-around",
  "space-between",
  "space-evenly",
] as const;
const BLOCK_ALIGN = ["start", "center", "end", "baseline", "stretch"] as const;
const WRAP = ["wrap", "nowrap"] as const;

export const attributes = z.object({
  gap: z.enum(GAP).optional().catch(undefined),
  align: z.enum(ALIGN).optional().catch(undefined),
  blockAlign: z.enum(BLOCK_ALIGN).optional().catch(undefined),
  wrap: z.enum(WRAP).optional().catch(undefined),
});

export const events: RemoteEvents = {};
