import { z } from "zod";

import type { RemoteEvents } from "./events";

export const TAG = "tangent-card-title" as const;

export const attributes = z.object({});

export const events: RemoteEvents = {};
