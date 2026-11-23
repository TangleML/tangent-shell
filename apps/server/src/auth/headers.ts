import type { IncomingHttpHeaders } from "node:http";

/** The first value of a header, or `undefined` when it is unset, empty, or unnamed. */
export function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  if (!name) return undefined;
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value) || undefined;
}
