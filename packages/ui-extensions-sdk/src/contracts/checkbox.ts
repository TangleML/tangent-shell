import { z } from "zod";

import type { RemoteEvents } from "./events";

export const TAG = "tangent-checkbox" as const;

// `checked` is required by the primitive; `.catch(false)` keeps it non-optional.
export const attributes = z.object({
  checked: z.boolean().catch(false),
  label: z.string().optional().catch(undefined),
});

export const events: RemoteEvents = {
  change: { handlerProp: "onCheckedChange", payload: "checked" },
};
