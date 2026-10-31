/**
 * Builds a Gravatar image URL for an email address. The email is trimmed and
 * lowercased, hashed with SHA-256 via the Web Crypto API (no md5 dependency),
 * and rendered to hex. `d=404` makes missing avatars return a 404 so the caller
 * can fall back to an initials badge rather than Gravatar's placeholder. The
 * requested size is doubled for retina displays.
 */
export async function gravatarUrl(
  email: string,
  size: number,
): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `https://gravatar.com/avatar/${hash}?s=${size * 2}&d=404`;
}
