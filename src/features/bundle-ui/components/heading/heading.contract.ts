import { z } from "zod";

import { TEXT_SIZE, TEXT_TONE, TEXT_WEIGHT } from "../_shared/enums";
import type { RemoteEvents } from "../_shared/events";

export const TAG = "tangent-heading" as const;

// `level` travels as a string on the wire; `preprocess(Number, …)` coerces it
// back to the numeric union `Heading` requires, and `.catch(1)` keeps it
// non-optional so it satisfies the primitive's required `level` prop.
export const attributes = z.object({
  level: z
    .preprocess(
      Number,
      z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.literal(6),
      ]),
    )
    .catch(1),
  size: z.enum(TEXT_SIZE).optional().catch(undefined),
  weight: z.enum(TEXT_WEIGHT).optional().catch(undefined),
  tone: z.enum(TEXT_TONE).optional().catch(undefined),
});

export const events: RemoteEvents = {};
