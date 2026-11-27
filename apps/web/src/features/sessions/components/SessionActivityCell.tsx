import type { Session } from "@tangent/shared/contracts";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";

import {
  useSessionAwaitingInput,
  useSessionStatus,
} from "@/features/sessions/model/sessionStatusContext";
import {
  awaitingInputLabel,
  awaitingSinceLabel,
} from "@/features/sessions/model/sessionStatusDisplay";
import { Pill } from "@/shared/ui/patterns/pill";

interface SessionActivityCellProps {
  session: Session;
}

/**
 * Per-session activity badge: waiting on an answer, needs-attention, working,
 * or task-complete. Prime's unanswered questions come first: they are what
 * blocks it, and only a person can clear them.
 */
export function SessionActivityCell({ session }: SessionActivityCellProps) {
  const runStatus = useSessionStatus(session.id);
  const awaiting = useSessionAwaitingInput(session.id);
  const {
    unreadCount = 0,
    hasError = false,
    activeAgentCount = 0,
  } = session.activity ?? {};

  if (awaiting) {
    const since = awaitingSinceLabel(awaiting);
    // Stacked so the cell stays narrow enough not to wrap the pill.
    return (
      <BlockStack gap="0.5" inlineAlign="start">
        <Pill size="xs" tone="warning">
          Needs your answer
        </Pill>
        <Text size="xs" tone="subdued">
          {awaitingInputLabel(awaiting)}
          {since ? ` · since ${since}` : ""}
        </Text>
      </BlockStack>
    );
  }

  if (hasError) {
    return (
      <Pill size="xs" tone="critical">
        Needs attention
      </Pill>
    );
  }

  // Count excludes Prime, so 0 while busy still means Prime is mid-run.
  if (runStatus === "busy") {
    return (
      <Pill size="xs" tone="info">
        {activeAgentCount > 0 ? `${activeAgentCount} working` : "Working"}
      </Pill>
    );
  }

  if (unreadCount === 0) {
    return (
      <Text size="sm" tone="subdued">
        &mdash;
      </Text>
    );
  }

  return (
    <InlineStack gap="1.5" blockAlign="center" wrap="nowrap">
      <Pill size="xs" tone="success">
        Task complete
      </Pill>
      <Text size="xs" tone="subdued">
        {unreadCount} new
      </Text>
    </InlineStack>
  );
}
