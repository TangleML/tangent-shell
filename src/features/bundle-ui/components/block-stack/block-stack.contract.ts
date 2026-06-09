import { z } from "zod";

import { GAP } from "../_shared/enums";
import type { RemoteEvents } from "../_shared/events";

export const TAG = "tangent-block-stack" as const;

const ALIGN = ["start", "center", "end", "stretch"] as const;
const INLINE_ALIGN = [
  "start",
  "center",
  "end",
  "space-around",
  "space-between",
  "space-evenly",
] as const;

export const attributes = z.object({
  gap: z.enum(GAP).optional().catch(undefined),
  align: z.enum(ALIGN).optional().catch(undefined),
  inlineAlign: z.enum(INLINE_ALIGN).optional().catch(undefined),
});

export const events: RemoteEvents = {};
