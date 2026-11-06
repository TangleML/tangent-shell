import type { Session } from "@tangent/shared/contracts";
import { BlockStack } from "@tangent/ui-primitives/layout";
import { type Ref, useEffect, useRef, useState } from "react";

import { agentBundleIconUrl } from "@/features/agent-bundles/api/agentBundlesApi";
import { SessionActionsMenu } from "@/features/sessions/components/SessionActionsMenu";
import { useSessionStatus } from "@/features/sessions/model/sessionStatusContext";
import { SESSION_STATUS_DISPLAY } from "@/features/sessions/model/sessionStatusDisplay";
import { ListItem } from "@/shared/ui/patterns/list-item";

interface SessionSwitcherListProps {
  sessions: Session[];
  onSelect: (id: string) => void;
  /** Highlighted row (keyboard navigation); scrolled into view when set. */
  selectedId?: string;
  /**
   * When provided, each row gets a hover-revealed actions menu (rename,
   * archive, delete) and this is called after a session is deleted. Omit it
   * (e.g. the dropdown switcher) to keep the list a plain quick-switch.
   */
  onDeleted?: (id: string) => void;
}

/**
 * Presentational list of selectable sessions shared by the list-style and
 * dropdown switcher variants.
 */
export function SessionSwitcherList({
  sessions,
  onSelect,
  selectedId,
  onDeleted,
}: SessionSwitcherListProps) {
  const selectedRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <BlockStack as="ul" gap="1">
      {sessions.map((session) => (
        <SessionListItem
          key={session.id}
          ref={session.id === selectedId ? selectedRef : undefined}
          session={session}
          selected={session.id === selectedId}
          onSelect={onSelect}
          onDeleted={onDeleted}
        />
      ))}
    </BlockStack>
  );
}

interface SessionListItemProps {
  ref?: Ref<HTMLLIElement>;
  session: Session;
  selected: boolean;
  onSelect: (id: string) => void;
  onDeleted?: (id: string) => void;
}

function SessionListItem({
  ref,
  session,
  selected,
  onSelect,
  onDeleted,
}: SessionListItemProps) {
  const status = useSessionStatus(session.id);
  const { label } = SESSION_STATUS_DISPLAY[status];
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <ListItem
      ref={ref}
      icon={
        session.config?.icon
          ? {
              src: agentBundleIconUrl(session.config.id),
              alt: `${session.config.name} icon`,
            }
          : "MessageSquare"
      }
      title={session.name}
      subtitle={label}
      flair={{
        kind: "dot",
        label,
        tone: status === "idle" ? "subdued" : "success",
        pulse: status === "busy",
      }}
      selected={selected}
      onOpen={() => onSelect(session.id)}
      menu={
        onDeleted
          ? {
              label: `Actions for ${session.name}`,
              open: menuOpen,
              onOpenChange: setMenuOpen,
              content: (
                <SessionActionsMenu
                  session={session}
                  onClose={() => setMenuOpen(false)}
                  onDeleted={onDeleted}
                />
              ),
            }
          : undefined
      }
    />
  );
}
