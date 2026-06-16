import type { Session } from "@tangent/shared/contracts";
import { useEffect, useRef } from "react";

import { agentBundleIconUrl } from "@/features/agent-bundles/api/agentBundlesApi";
import { SessionActionsMenu } from "@/features/sessions/components/SessionActionsMenu";
import { BundleIconImage } from "@/routes/agent-bundles/bundle-grid";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { HoverReveal } from "@/shared/ui/patterns/hover-reveal";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { Truncating } from "@/shared/ui/patterns/truncating";
import { Text } from "@/shared/ui/typography";

import { StatusDot } from "./StatusDot";

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
            <Icon name="Package" size="lg" tone="subdued" />
          )}
          <BlockStack grow>
            <Truncating>
              <Text size="xs" weight="medium" truncate title={session.name}>
                {session.name}
              </Text>
            </Truncating>
            {/* Placeholder metadata — reserves space for live running status
                and execution stats until those are wired up. */}
            <InlineStack gap="2" blockAlign="center" wrap="nowrap">
              <InlineStack gap="1" blockAlign="center" wrap="nowrap">
                <StatusDot connected={false} />
                <Text size="xs" tone="subdued">
                  Idle
                </Text>
              </InlineStack>
            </InlineStack>
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
