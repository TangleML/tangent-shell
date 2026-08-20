import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

import type { EmbedResourceRow, TangentResourceListElementLike } from "./types";

export interface ResourceListProps {
  /** The session whose catalogued resources to render. */
  sessionId: string;
  /** Scopes the catalog to a sub-agent's Conversation; defaults to Prime's. */
  agentId?: string;
  /** A viewable row was clicked; the host decides how to open the resource. */
  onOpen: (resource: EmbedResourceRow) => void;
  /** Disambiguates the provider when a page mounts more than one. */
  instance?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders the embedded resource list as `<tangent-resource-list>`. Wire `onOpen`
 * to place an `<ArtifactViewer>` at the resource's resolved `url`; non-viewable
 * kinds (memory, attachment) read as inert rows and never fire `onOpen`.
 */
export function ResourceList({
  sessionId,
  agentId,
  onOpen,
  instance,
  className,
  style,
}: ResourceListProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = ref.current as TangentResourceListElementLike | null;
    if (element) element.sessionId = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const element = ref.current as TangentResourceListElementLike | null;
    if (element && agentId != null) element.agentId = agentId;
  }, [agentId]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handleOpen = (event: Event) => {
      onOpen((event as CustomEvent<EmbedResourceRow>).detail);
    };
    element.addEventListener("open-resource", handleOpen);
    return () => {
      element.removeEventListener("open-resource", handleOpen);
    };
  }, [onOpen]);

  return (
    <tangent-resource-list
      ref={ref}
      instance={instance}
      className={className}
      style={{ height: "100%", ...style }}
    />
  );
}
