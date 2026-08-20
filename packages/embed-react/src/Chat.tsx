import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

import type { TangentChatElementLike } from "./types";

export interface ChatProps {
  /** The session to render. Obtain a new one from `useTangent().newSession`. */
  sessionId: string;
  /** Render this agent's thread instead of Prime. */
  agentId?: string;
  /** A prompt to send once the session has joined (e.g. for a fresh session). */
  initialPrompt?: string;
  /** The host opens the resource however it wants (tab, drawer, ...). */
  onOpenArtifact?: (url: string, title: string) => void;
  /** Fired when the user submits a prompt, so the host can react. */
  onSendPrompt?: (content: string) => void;
  /** Fired on a runtime error surfaced by the chat. */
  onError?: (message: string) => void;
  /** Disambiguates the provider when a page mounts more than one. */
  instance?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders the embedded chat (message list + composer) as `<tangent-chat>`.
 * Rich values are assigned as element properties; `on*` callbacks bind to the
 * element's `CustomEvent`s.
 */
export function Chat({
  sessionId,
  agentId,
  initialPrompt,
  onOpenArtifact,
  onSendPrompt,
  onError,
  instance,
  className,
  style,
}: ChatProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = ref.current as TangentChatElementLike | null;
    if (element) element.sessionId = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const element = ref.current as TangentChatElementLike | null;
    if (element) element.agentId = agentId ?? "";
  }, [agentId]);

  useEffect(() => {
    const element = ref.current as TangentChatElementLike | null;
    if (element && initialPrompt != null) element.initialPrompt = initialPrompt;
  }, [initialPrompt]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handleArtifact = (event: Event) => {
      const detail = (event as CustomEvent<{ url: string; title: string }>)
        .detail;
      onOpenArtifact?.(detail.url, detail.title);
    };
    const handleSend = (event: Event) => {
      onSendPrompt?.(
        (event as CustomEvent<{ content: string }>).detail.content,
      );
    };
    const handleError = (event: Event) => {
      onError?.((event as CustomEvent<{ message: string }>).detail.message);
    };
    element.addEventListener("open-artifact", handleArtifact);
    element.addEventListener("send-prompt", handleSend);
    element.addEventListener("error", handleError);
    return () => {
      element.removeEventListener("open-artifact", handleArtifact);
      element.removeEventListener("send-prompt", handleSend);
      element.removeEventListener("error", handleError);
    };
  }, [onOpenArtifact, onSendPrompt, onError]);

  return (
    <tangent-chat
      ref={ref}
      instance={instance}
      className={className}
      style={{ height: "100%", ...style }}
    />
  );
}
