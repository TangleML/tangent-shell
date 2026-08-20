import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

import type { TangentSessionListElementLike } from "./types";

export interface SessionListProps {
  /** Highlighted row; scrolled into view when set. */
  selectedId?: string;
  /** A row was clicked; the host decides what selecting a session means. */
  onSelect: (id: string) => void;
  /** A session was deleted from its row menu. */
  onDeleted?: (id: string) => void;
  /** Disambiguates the provider when a page mounts more than one. */
  instance?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders the embedded session list as `<tangent-session-list>`. The list
 * fetches its own sessions; the host wires `onSelect` (and optionally
 * `onDeleted`) and can highlight a row with `selectedId`.
 */
export function SessionList({
  selectedId,
  onSelect,
  onDeleted,
  instance,
  className,
  style,
}: SessionListProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = ref.current as TangentSessionListElementLike | null;
    if (element && selectedId != null) element.selectedId = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handleSelect = (event: Event) => {
      onSelect((event as CustomEvent<{ id: string }>).detail.id);
    };
    const handleDeleted = (event: Event) => {
      onDeleted?.((event as CustomEvent<{ id: string }>).detail.id);
    };
    element.addEventListener("select-session", handleSelect);
    element.addEventListener("session-deleted", handleDeleted);
    return () => {
      element.removeEventListener("select-session", handleSelect);
      element.removeEventListener("session-deleted", handleDeleted);
    };
  }, [onSelect, onDeleted]);

  return (
    <tangent-session-list
      ref={ref}
      instance={instance}
      className={className}
      style={{ height: "100%", ...style }}
    />
  );
}
