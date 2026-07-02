import type { IconName } from "@tangent/ui-primitives/icon";
import { icons } from "lucide-react";
import { z } from "zod";

import type { RemoteEvents } from "./events";

export const TAG = "tangent-icon" as const;

const SIZE = ["xs", "sm", "md", "lg", "xl", "2xl", "fill"] as const;
const TONE = [
  "inherit",
  "subdued",
  "strong",
  "weak",
  "critical",
  "warning",
  "success",
  "info",
  "accent",
  "magic",
] as const;

export const attributes = z.object({
  // `name` must resolve to a real Lucide icon; the host renders nothing if not.
  name: z.custom<IconName>((v) => typeof v === "string" && v in icons),
  size: z.enum(SIZE).optional().catch(undefined),
  tone: z.enum(TONE).optional().catch(undefined),
});

export const events: RemoteEvents = {};
