/**
 * Normalizes the `arguments` an agent passes to `call_remote_tool` into the
 * plain object a host's tool expects.
 *
 * Hosts validate their arguments as a record, so anything else reaches them as
 * "missing" arguments. Models sometimes send the arguments JSON-encoded as a
 * string instead of as an object; that string is decoded here. A missing value
 * becomes `{}`, for tools that take no arguments. Anything that is not (or does
 * not decode to) a JSON object is rejected with a message the agent can act on.
 */
export function normalizeRemoteToolArguments(
  args: unknown,
): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  if (typeof args === "string") return decodeArgumentsString(args);
  if (isPlainObject(args)) return args;
  throw new Error(
    `\`arguments\` must be a JSON object, not ${describe(args)}.`,
  );
}

function decodeArgumentsString(text: string): Record<string, unknown> {
  if (text.trim() === "") return {};
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new Error(
      "`arguments` must be a JSON object; got a string that is not valid JSON. " +
        "Pass the arguments as an object, not a string.",
    );
  }
  if (!isPlainObject(decoded)) {
    throw new Error(
      `\`arguments\` must be a JSON object; got a string that decodes to ${describe(decoded)}.`,
    );
  }
  return decoded;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
