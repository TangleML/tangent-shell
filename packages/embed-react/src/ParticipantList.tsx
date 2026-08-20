import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

import type {
  EmbedMuteToggle,
  TangentParticipantListElementLike,
} from "./types";

export interface ParticipantListProps {
  /** The session whose roster to render. */
  sessionId: string;
  /** The Conversation a mute acts on; defaults to Prime's thread. */
  agentId?: string;
  /** An agent's mute state was toggled in the active Conversation. */
  onToggleMute?: (toggle: EmbedMuteToggle) => void;
  /** Disambiguates the provider when a page mounts more than one. */
  instance?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders the embedded participant list as `<tangent-participant-list>`. The
 * mute toggle mutates the shared session state directly; `onToggleMute` fires
 * afterwards so the host can react.
 */
export function ParticipantList({
  sessionId,
  agentId,
  onToggleMute,
  instance,
  className,
  style,
}: ParticipantListProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = ref.current as TangentParticipantListElementLike | null;
    if (element) element.sessionId = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const element = ref.current as TangentParticipantListElementLike | null;
    if (element && agentId != null) element.agentId = agentId;
  }, [agentId]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handleToggle = (event: Event) => {
      onToggleMute?.((event as CustomEvent<EmbedMuteToggle>).detail);
    };
    element.addEventListener("toggle-mute", handleToggle);
    return () => {
      element.removeEventListener("toggle-mute", handleToggle);
    };
  }, [onToggleMute]);

  return (
    <tangent-participant-list
      ref={ref}
      instance={instance}
      className={className}
      style={{ height: "100%", ...style }}
    />
  );
}
