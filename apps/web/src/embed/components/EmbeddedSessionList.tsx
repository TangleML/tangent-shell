import { Box } from "@tangent/ui-primitives/box";

import { SessionSwitcherList } from "@/features/chat/components/sidebar/sessions/SessionSwitcherList";
import { SessionStatusProvider } from "@/features/sessions/components/SessionStatusProvider";
import { useSessions } from "@/features/sessions/hooks/useSessions";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";

interface EmbeddedSessionListProps {
  /** Highlighted row; scrolled into view when set. */
  selectedId?: string;
  /** A row was clicked; the host decides what selecting a session means. */
  onSelect: (id: string) => void;
  /** A session was deleted from its row menu (host reacts if it was current). */
  onDeleted: (id: string) => void;
}

/**
 * The embedded session list: the shared `SessionSwitcherList` fed by its own
 * `useSessions` query and wrapped in `SessionStatusProvider` for live run-status
 * dots. Row actions (rename/archive/delete) come from `onDeleted` being set.
 */
export function EmbeddedSessionList({
  selectedId,
  onSelect,
  onDeleted,
}: EmbeddedSessionListProps) {
  const { data: sessions } = useSessions();

  return (
    <SessionStatusProvider>
      <ScrollRegion>
        <Box inlineSize="full" paddingBlock="sm" paddingInline="sm">
          <SessionSwitcherList
            sessions={sessions ?? []}
            onSelect={onSelect}
            selectedId={selectedId}
            onDeleted={onDeleted}
          />
        </Box>
      </ScrollRegion>
    </SessionStatusProvider>
  );
}
