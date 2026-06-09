// local primitive — renders a "page" artifact (HTML, PDF, image, text) inside a
// sandboxed iframe. There is no Tangle iframe primitive, so the raw <iframe>
// element with scoped classes is an allowed escape hatch.

interface ArtifactTabViewProps {
  /** Resolved artifact URL under the session file API. */
  url: string;
  /** Human-readable title (used for the iframe's accessible name). */
  title: string;
}

/**
 * Sandboxed viewer for an opened "page" artifact. Scripts are allowed so
 * interactive pages work, but `allow-same-origin` is intentionally omitted: the
 * frame runs in an opaque origin and cannot reach the app's cookies or APIs.
 * Relative page assets still resolve since they load against the document URL.
 */
export function ArtifactTabView({ url, title }: ArtifactTabViewProps) {
  return (
    <iframe
      src={url}
      title={title}
      sandbox="allow-scripts allow-popups allow-forms"
      className="min-h-0 w-full flex-1 border-0 bg-white"
    />
  );
}
