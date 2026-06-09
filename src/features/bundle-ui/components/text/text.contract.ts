import { z } from "zod";

import { TEXT_SIZE, TEXT_TONE, TEXT_WEIGHT } from "../_shared/enums";
import type { RemoteEvents } from "../_shared/events";

export const TAG = "tangent-text" as const;

export const attributes = z.object({
  size: z.enum(TEXT_SIZE).optional().catch(undefined),
  tone: z.enum(TEXT_TONE).optional().catch(undefined),
  weight: z.enum(TEXT_WEIGHT).optional().catch(undefined),
});

export const events: RemoteEvents = {};
