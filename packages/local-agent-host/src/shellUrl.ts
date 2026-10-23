/**
 * Normalizes a user-entered Shell URL to its origin plus any mount path,
 * without a trailing slash. Throws on anything that is not http(s).
 */
export function normalizeShellUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The Shell URL must start with http:// or https://");
  }
  const sessionPath = url.pathname.indexOf("/sessions");
  const mount =
    sessionPath === -1 ? url.pathname : url.pathname.slice(0, sessionPath);
  return `${url.origin}${mount}`.replace(/\/+$/, "");
}

/** The session id a pasted Shell URL points at, if it names one. */
export function sessionIdFromUrl(input: string): string | undefined {
  const match = /\/sessions\/([^/?#]+)/.exec(input);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/** Extracts a session id from a pasted Shell session URL, or returns the raw id. */
export function parseSessionRef(input: string): string {
  const trimmed = input.trim();
  return sessionIdFromUrl(trimmed) ?? trimmed;
}
