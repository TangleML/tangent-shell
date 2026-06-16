import { z } from "zod";

import type { RemoteEvents } from "../_shared/events";

export const TAG = "tangent-card-description" as const;

export const attributes = z.object({});

export const events: RemoteEvents = {};
