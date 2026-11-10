import type { PinnedArtifact } from "./contracts.ts";

/** Longest URL a link pin accepts; generous for real links, bounded for storage. */
export const MAX_PINNABLE_URL_LENGTH = 2048;

const PINNABLE_PROTOCOLS = new Set(["http:", "https:"]);

// The WHATWG URL global exists in Node and browsers, but this package compiles
// without DOM or Node lib types; declare just the surface used here.
interface ParsedUrl {
  href: string;
  protocol: string;
  host: string;
  hostname: string;
  username: string;
  password: string;
}
declare const URL: new (input: string) => ParsedUrl;

/**
 * Validates a URL for a link pin and returns its canonical `href` (the dedupe
 * key), or null. Only absolute http(s) URLs with a host are accepted; script,
 * data, file, and other schemes are rejected, as are URLs carrying credentials.
 */
export function normalizePinnableUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_PINNABLE_URL_LENGTH) return null;

  let url: ParsedUrl;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (!PINNABLE_PROTOCOLS.has(url.protocol) || !url.hostname) return null;
  if (url.username || url.password) return null;
  if (url.href.length > MAX_PINNABLE_URL_LENGTH) return null;
  return url.href;
}

/** True for a scheme-qualified or protocol-relative reference, never a workspace path. */
export function isUrlLike(value: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(value.trim()) || value.trim().startsWith("//")
  );
}

/** A pin's dedupe key: an artifact's workspace path or a link's canonical URL. */
export function pinKey(pin: PinnedArtifact): string {
  return pin.kind === "link" ? pin.url : pin.path;
}

/** A link pin's title: the given one, else the URL's host. */
export function linkPinTitle(url: string, title?: string): string {
  return title?.trim() || new URL(url).host;
}
