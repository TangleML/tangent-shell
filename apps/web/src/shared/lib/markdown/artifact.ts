/**
 * Helpers for resolving and classifying artifact references shared between the
 * markdown renderer (which turns relative links into artifact chips) and the
 * sidebar's pinned-artifact list. Kept in their own module so both can import
 * them without tripping the react-refresh "only export components" rule.
 */

const ARTIFACTS_LINK = /^(?:\.\/)?artifacts\//i;

// Read the way a browser and the file route do, so an encoded or backslashed
// `..` counts as one.
function hasParentStep(url: string): boolean {
  return url
    .split(/[?#]/, 1)[0]
    .replace(/%2e/gi, ".")
    .replace(/%2f|%5c|\\/gi, "/")
    .split("/")
    .includes("..");
}

/** True for a relative `artifacts/`-prefixed reference (the safety-net target). */
export function isArtifactsLink(url: string): boolean {
  return ARTIFACTS_LINK.test(url) && !hasParentStep(url);
}

/** True for URLs we must not rewrite (absolute, anchor, or non-file schemes). */
export function isAbsoluteUrl(url: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(url) || // http:, https:, data:, mailto:, ...
    url.startsWith("/") ||
    url.startsWith("#")
  );
}

/** True for a path that stays among the session's files: relative, no `..` step. */
export function isSessionFilePath(url: string): boolean {
  return !isAbsoluteUrl(url) && !hasParentStep(url);
}

/**
 * Normalizes a relative artifact href into its workspace-relative path (e.g.
 * `./report.html` -> `report.html`). This is the stable identity used to pin
 * and dedupe artifacts, matching what the server stores.
 */
export function artifactPath(url: string): string {
  return url.replace(/^\.\//, "");
}

/**
 * Resolves a relative artifact reference against the session's file base. One
 * that steps out with `..` resolves to nothing.
 */
export function resolveUrl(
  url: string | undefined,
  base: string,
): string | undefined {
  if (!url || isAbsoluteUrl(url)) return url;
  if (hasParentStep(url)) return undefined;
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

/**
 * True when an artifact URL points at a Markdown document. These are fetched
 * and rendered as formatted Markdown rather than shown as raw source.
 */
export function isMarkdownArtifact(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0];
  return path.split(".").pop()?.toLowerCase() === "md";
}

const TEXT_ARTIFACT_EXTENSIONS = new Set(["txt", "log", "csv", "json"]);

/**
 * True when an artifact URL points at plain text. These are fetched and shown
 * in the app's own colors, since a text file in a frame takes the browser's
 * dark-mode text but none of a background to read it on.
 */
export function isTextArtifact(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0];
  const ext = path.split(".").pop()?.toLowerCase();
  return ext != null && TEXT_ARTIFACT_EXTENSIONS.has(ext);
}

/**
 * True when an artifact URL points at a PDF document. These are rendered via an
 * un-sandboxed `<object>`: Chrome renders PDFs with a plugin that sandboxed
 * iframes disable regardless of `allow-same-origin`.
 */
export function isPdfArtifact(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0];
  return path.split(".").pop()?.toLowerCase() === "pdf";
}

/** Extracts the scheme from a `proto://…` href (lowercased), else undefined. */
export function protocolOf(href: string | undefined): string | undefined {
  if (typeof href !== "string") return undefined;
  const match = href.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  return match ? match[1].toLowerCase() : undefined;
}
