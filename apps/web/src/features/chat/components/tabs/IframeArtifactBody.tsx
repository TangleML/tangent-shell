// local primitive — renders an HTML (or other page) artifact inside a
// sandboxed iframe. There is no Tangle iframe primitive, so the raw <iframe>
// element with scoped classes is an allowed escape hatch.

interface IframeArtifactBodyProps {
  /** Resolved artifact URL under the session file API. */
  url: string;
  /** Human-readable title (used for the iframe's accessible name). */
  title: string;
}

/**
 * Sandboxed viewer for HTML (and other page) artifacts. Scripts are allowed so
 * interactive pages work, but `allow-same-origin` is intentionally omitted: the
 * frame runs in an opaque origin and cannot reach the app's cookies or APIs.
 * Relative page assets still resolve since they load against the document URL.
 */
export function IframeArtifactBody({ url, title }: IframeArtifactBodyProps) {
  return (
    <iframe
      src={url}
      title={title}
      sandbox="allow-scripts allow-popups allow-forms"
      className="absolute inset-0 h-full w-full border-0 bg-white"
    />
  );
}
