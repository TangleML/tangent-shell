import type { Session } from "@tangent/shared/contracts";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";
import { useEffect, useRef } from "react";

import { agentBundleIconUrl } from "@/features/agent-bundles/api/agentBundlesApi";
import { SessionActionsMenu } from "@/features/sessions/components/SessionActionsMenu";
import { SessionStatusIndicator } from "@/features/sessions/components/SessionStatusIndicator";
import { BundleIconImage } from "@/routes/agent-bundles/bundle-grid";
import { HoverReveal } from "@/shared/ui/patterns/hover-reveal";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { Truncating } from "@/shared/ui/patterns/truncating";

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
          density="comfortable"
          gap="3"
          hoverable
          border="sm"
          selected={session.id === selectedId}
          onClick={() => onSelect(session.id)}
        >
          {session.config?.icon ? (
            <BundleIconImage
              size="sm"
              src={agentBundleIconUrl(session.config.id)}
              alt={`${session.config.name} icon`}
            />
          ) : (
            <Icon name="MessageSquare" size="lg" tone="subdued" />
          )}
          <BlockStack grow align="stretch">
            <Truncating>
              <Text
                as="p"
                size="xs"
                weight="medium"
                truncate
                title={session.name}
              >
                {session.name}
              </Text>
            </Truncating>
            {/* Live run status from the lobby socket. */}
            <SessionStatusIndicator sessionId={session.id} />
          </BlockStack>
          {onDeleted ? (
            <HoverReveal>
              <SessionActionsMenu session={session} onDeleted={onDeleted} />
            </HoverReveal>
          ) : null}
        </ListRow>
      ))}
    </BlockStack>
  );
}
