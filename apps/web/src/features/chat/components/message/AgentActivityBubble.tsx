import type { AgentActivity, AgentRole } from "@tangent/shared/contracts";
import { InlineStack } from "@tangent/ui-primitives/layout";
import { Spinner } from "@tangent/ui-primitives/spinner";
import { Text } from "@tangent/ui-primitives/typography";

import { MessageAvatar } from "./MessageAvatar";
import { MessageLayout } from "./MessageLayout";

interface AgentActivityBubbleProps {
  activity: AgentActivity;
  /** The thread owner this activity belongs to, so the bubble is attributed. */
  authorName: string;
  authorRole: AgentRole;
}

const SPINNER_SIZE = 14;

/**
 * Ephemeral leaf bubble showing what the agent is doing between messages (a
 * running tool, or "thinking"). Rendered only while the run is busy and no
 * message is streaming; it is never persisted and disappears as soon as the
 * next message arrives. Attributed to the thread's own agent rather than
 * always Prime, so a sub-agent thread's activity reads as that sub-agent's.
 */
export function AgentActivityBubble({
  activity,
  authorName,
  authorRole,
}: AgentActivityBubbleProps) {
  return (
    <MessageLayout
      variant="agent"
      avatar={
        <MessageAvatar kind="agent" name={authorName} agentRole={authorRole} />
      }
    >
      <InlineStack gap="2" blockAlign="center" wrap="nowrap">
        <Spinner size={SPINNER_SIZE} />
        <Text size="sm" tone="subdued">
          {activity.label}
        </Text>
      </InlineStack>
    </MessageLayout>
  );
}
