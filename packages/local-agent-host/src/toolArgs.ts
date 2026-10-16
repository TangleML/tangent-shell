export type ToolArgs = Record<string, unknown>;

export function toArgs(args: unknown): ToolArgs {
  if (args === undefined || args === null) return {};
  if (typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Arguments must be a JSON object.");
  }
  return args as ToolArgs;
}

export function optionalString(
  args: ToolArgs,
  key: string,
): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`"${key}" must be a string.`);
  return value;
}

export function requiredString(args: ToolArgs, key: string): string {
  const value = optionalString(args, key);
  if (value === undefined) throw new Error(`"${key}" is required.`);
  return value;
}

/** A positive integer argument, clamped to `max`. */
export function boundedInt(
  args: ToolArgs,
  key: string,
  fallback: number,
  max: number,
): number {
  const value = args[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error(`"${key}" must be a positive number.`);
  }
  return Math.min(Math.floor(value), max);
}
