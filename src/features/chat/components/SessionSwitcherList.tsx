import type { Session } from "@shared/contracts";
import { useEffect, useRef } from "react";

import { BlockStack } from "@/shared/ui/layout";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { Truncating } from "@/shared/ui/patterns/truncating";
import { Text } from "@/shared/ui/typography";

interface SessionSwitcherListProps {
  sessions: Session[];
  onSelect: (id: string) => void;
  /** Highlighted row (keyboard navigation); scrolled into view when set. */
  selectedId?: string;
}

/**
 * Presentational list of selectable sessions shared by the list-style and
 * dropdown switcher variants.
 */
export function SessionSwitcherList({
  sessions,
  onSelect,
  selectedId,
}: SessionSwitcherListProps) {
  const selectedRef = useRef<HTMLElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <BlockStack as="ul" gap="1">
      {sessions.map((session) => (
        <ListRow
          key={session.id}
          ref={session.id === selectedId ? selectedRef : undefined}
          as="li"
          density="cozy"
          gap="2"
          hoverable
          selected={session.id === selectedId}
          onClick={() => onSelect(session.id)}
        >
          <Truncating>
            <Text size="sm" truncate title={session.name}>
              {session.name}
            </Text>
          </Truncating>
        </ListRow>
      ))}
    </BlockStack>
  );
}
