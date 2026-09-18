import { z } from "zod";

import type { RemoteEvents } from "./events";

export const TAG = "tangent-textarea" as const;

export const attributes = z.object({
  value: z.string().optional().catch(undefined),
  placeholder: z.string().optional().catch(undefined),
  disabled: z.boolean().optional().catch(undefined),
});

export const events: RemoteEvents = {
  input: { handlerProp: "onInput", payload: "value" },
};
