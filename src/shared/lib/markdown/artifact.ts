/**
 * Helpers for resolving and classifying artifact references shared between the
 * markdown renderer (which turns relative links into artifact chips) and the
 * sidebar's pinned-artifact list. Kept in their own module so both can import
 * them without tripping the react-refresh "only export components" rule.
 */

/** True for URLs we must not rewrite (absolute, anchor, or non-file schemes). */
export function isAbsoluteUrl(url: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(url) || // http:, https:, data:, mailto:, ...
    url.startsWith("/") ||
    url.startsWith("#")
  );
}

/**
 * Normalizes a relative artifact href into its workspace-relative path (e.g.
 * `./report.html` -> `report.html`). This is the stable identity used to pin
 * and dedupe artifacts, matching what the server stores.
 */
export function artifactPath(url: string): string {
  return url.replace(/^\.\//, "");
}

/** Resolves a relative artifact reference against the session's file base. */
export function resolveUrl(
  url: string | undefined,
  base: string,
): string | undefined {
  if (!url || isAbsoluteUrl(url)) return url;
  return `${base}/${artifactPath(url)}`;
}

/**
 * File extensions a browser can render inline (HTML pages, PDFs, images, and
 * plain-text formats). Links to these "page" artifacts open in an in-app tab;
 * anything else stays a download chip.
 */
const VIEWABLE_ARTIFACT_EXTENSIONS = new Set([
  "html",
  "htm",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "txt",
  "md",
  "json",
  "csv",
  "log",
]);

/** True when an artifact URL points at a browser-viewable "page" artifact. */
export function isViewableArtifact(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0];
  const ext = path.split(".").pop()?.toLowerCase();
  return ext != null && VIEWABLE_ARTIFACT_EXTENSIONS.has(ext);
}
