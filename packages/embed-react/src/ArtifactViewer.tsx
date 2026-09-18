import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

import type { TangentArtifactViewerElementLike } from "./types";

export interface ArtifactViewerProps {
  /** Session that owns the artifact; review screenshots upload into it. */
  sessionId: string;
  /** Resolved artifact URL (e.g. from `<Chat onOpenArtifact>`). */
  url: string;
  /** Human-readable title (the iframe's accessible name). */
  title: string;
  /** A review was submitted; feed it to a `<Chat>` to send it to Prime. */
  onSendPrompt?: (content: string, attachments?: unknown[]) => void;
  /** Disambiguates the provider when a page mounts more than one. */
  instance?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders the embedded artifact viewer as `<tangent-artifact-viewer>`. Point it
 * at a resolved artifact `url`; a submitted review surfaces via `onSendPrompt`.
 */
export function ArtifactViewer({
  sessionId,
  url,
  title,
  onSendPrompt,
  instance,
  className,
  style,
}: ArtifactViewerProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = ref.current as TangentArtifactViewerElementLike | null;
    if (element) element.sessionId = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const element = ref.current as TangentArtifactViewerElementLike | null;
    if (element) element.url = url;
  }, [url]);

  useEffect(() => {
    const element = ref.current as TangentArtifactViewerElementLike | null;
    if (element) element.title = title;
  }, [title]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handleSend = (event: Event) => {
      const detail = (
        event as CustomEvent<{ content: string; attachments?: unknown[] }>
      ).detail;
      onSendPrompt?.(detail.content, detail.attachments);
    };
    element.addEventListener("send-prompt", handleSend);
    return () => {
      element.removeEventListener("send-prompt", handleSend);
    };
  }, [onSendPrompt]);

  return (
    <tangent-artifact-viewer
      ref={ref}
      instance={instance}
      className={className}
      style={{ height: "100%", ...style }}
    />
  );
}
