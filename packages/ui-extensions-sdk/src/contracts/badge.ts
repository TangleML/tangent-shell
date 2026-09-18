import { z } from "zod";

import type { RemoteEvents } from "./events";

export const TAG = "tangent-badge" as const;

// Curated subset of Badge variants safe for third-party components. `asChild`
// and `className` escape hatches are intentionally omitted.
const VARIANT = [
  "default",
  "inform",
  "secondary",
  "destructive",
  "outline",
  "dot",
] as const;
const SIZE = ["xs", "sm", "md"] as const;
const POSITION = ["inline", "block", "topright", "topleft"] as const;
const SHAPE = ["rectangle", "rounded"] as const;

export const attributes = z.object({
  variant: z.enum(VARIANT).optional().catch(undefined),
  size: z.enum(SIZE).optional().catch(undefined),
  position: z.enum(POSITION).optional().catch(undefined),
  shape: z.enum(SHAPE).optional().catch(undefined),
});

export const events: RemoteEvents = {};
