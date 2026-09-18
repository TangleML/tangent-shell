import { z } from "zod";

import type { RemoteEvents } from "./events";

export const TAG = "tangent-button" as const;

// Curated subset of Button variants/sizes safe for third-party components.
const VARIANT = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "link",
] as const;
const SIZE = ["default", "xs", "sm", "lg"] as const;
const TONE = ["default", "critical", "warning", "success"] as const;

export const attributes = z.object({
  variant: z.enum(VARIANT).optional().catch(undefined),
  size: z.enum(SIZE).optional().catch(undefined),
  tone: z.enum(TONE).optional().catch(undefined),
  disabled: z.boolean().optional().catch(undefined),
});

export const events: RemoteEvents = {
  press: { handlerProp: "onPress", payload: "none" },
};
