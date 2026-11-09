import type { z } from "zod";

import type { MemoryExecuteResult } from "./types.ts";

/** An agent-facing rejection: no effects, surfaced by the route as a 400. */
export function rejected(text: string): MemoryExecuteResult {
  return { text, error: true };
}

/** Formats a params validation failure for the calling agent. */
export function invalidParams(
  name: string,
  error: z.ZodError,
): MemoryExecuteResult {
  const issues = error.issues
    .map((issue) => `${issue.path.join(".") || "params"}: ${issue.message}`)
    .join("; ");
  return rejected(`Invalid ${name} call: ${issues}`);
}
