import type { Attachment } from "@tangent/shared/contracts";

import { ArtifactTabView } from "@/features/chat/components/tabs/ArtifactTabView";

interface EmbeddedArtifactViewerProps {
  /** Session that owns the artifact; review screenshots upload into it. */
  sessionId: string;
  /** Resolved artifact URL under the session file API. */
  url: string;
  /** Human-readable title (the iframe's accessible name). */
  title: string;
  /** Forwards a review prompt (with the screenshot attached) to the host. */
  onSendPrompt?: (content: string, attachments?: Attachment[]) => void;
}

/**
 * The embedded artifact viewer: the shared `ArtifactTabView` with review-to-host
 * wiring. The host decides what to do with a review prompt (usually feed it to a
 * `<tangent-chat>`).
 */
export function EmbeddedArtifactViewer({
  sessionId,
  url,
  title,
  onSendPrompt,
}: EmbeddedArtifactViewerProps) {
  return (
    <ArtifactTabView
      sessionId={sessionId}
      url={url}
      title={title}
      onSendPrompt={(content, attachments) =>
        onSendPrompt?.(content, attachments)
      }
    />
  );
}
