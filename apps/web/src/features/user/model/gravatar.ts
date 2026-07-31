/**
 * Builds the Gravatar image URL for an email using a SHA-256 hash (Gravatar
 * accepts SHA-256, so we avoid an md5 dependency and Node `crypto`, neither of
 * which work in the browser). `d=404` makes Gravatar 404 when no avatar exists.
 * Returns `null` for an empty email.
 */
async function gravatarUrl(
  email: string,
  size: number,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`;
}

/**
 * Resolves the Gravatar URL for an email, returning it only when the avatar
 * actually exists. Thanks to `d=404`, Gravatar 404s for emails with no avatar,
 * so a failed fetch (or non-`ok` response) resolves to `null` and callers can
 * show a fallback. Gravatar serves permissive CORS, so this cross-origin fetch
 * is readable and its response is reused by the `<img>` from cache.
 */
export async function resolveGravatarUrl(
  email: string,
  size: number,
): Promise<string | null> {
  const url = await gravatarUrl(email, size);
  if (!url) return null;

  const res = await fetch(url);
  return res.ok ? url : null;
}
