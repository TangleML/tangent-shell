import type { Session } from "@tangent/shared/contracts";
import { InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";

import { useSessionStatus } from "@/features/sessions/model/sessionStatusContext";
import { Pill } from "@/shared/ui/patterns/pill";

interface SessionActivityCellProps {
  session: Session;
}

/** Per-session activity badge: needs-attention, working, or task-complete. */
export function SessionActivityCell({ session }: SessionActivityCellProps) {
  const runStatus = useSessionStatus(session.id);
  const {
    unreadCount = 0,
    hasError = false,
    activeAgentCount = 0,
  } = session.activity ?? {};

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
