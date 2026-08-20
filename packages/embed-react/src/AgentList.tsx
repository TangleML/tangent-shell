import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

import type { EmbedAgent, TangentAgentListElementLike } from "./types";

export interface AgentListProps {
  /** The session whose agents to render. */
  sessionId: string;
  /** Highlighted row (Prime or a sub-agent id). */
  selectedId?: string;
  /** A card was clicked; the host decides what opening an agent means. */
  onOpen: (agent: EmbedAgent) => void;
  /** A killed sub-agent was dismissed from the list. */
  onRemove?: (id: string) => void;
  /** Disambiguates the provider when a page mounts more than one. */
  instance?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders the embedded agent list as `<tangent-agent-list>`. Wire `onOpen` to
 * place a `<Chat agentId={agent.id}>`; dismissals surface via `onRemove`.
 */
export function AgentList({
  sessionId,
  selectedId,
  onOpen,
  onRemove,
  instance,
  className,
  style,
}: AgentListProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = ref.current as TangentAgentListElementLike | null;
    if (element) element.sessionId = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const element = ref.current as TangentAgentListElementLike | null;
    if (element && selectedId != null) element.selectedId = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handleOpen = (event: Event) => {
      onOpen((event as CustomEvent<EmbedAgent>).detail);
    };
    const handleRemove = (event: Event) => {
      onRemove?.((event as CustomEvent<{ id: string }>).detail.id);
    };
    element.addEventListener("open-agent", handleOpen);
    element.addEventListener("remove-agent", handleRemove);
    return () => {
      element.removeEventListener("open-agent", handleOpen);
      element.removeEventListener("remove-agent", handleRemove);
    };
  }, [onOpen, onRemove]);

  return (
    <tangent-agent-list
      ref={ref}
      instance={instance}
      className={className}
      style={{ height: "100%", ...style }}
    />
  );
}
