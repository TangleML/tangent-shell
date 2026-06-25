import type { AgentActivity } from "@tangent/shared/contracts";
import { InlineStack } from "@tangent/ui-primitives/layout";
import { Spinner } from "@tangent/ui-primitives/spinner";
import { Text } from "@tangent/ui-primitives/typography";

import { MessageAvatar } from "./MessageAvatar";
import { MessageLayout } from "./MessageLayout";

interface AgentActivityBubbleProps {
  activity: AgentActivity;
}

const SPINNER_SIZE = 14;

/**
 * Ephemeral leaf bubble showing what the agent is doing between messages (a
 * running tool, or "thinking"). Rendered only while the run is busy and no
 * message is streaming; it is never persisted and disappears as soon as the
 * next message arrives.
 */
export function AgentActivityBubble({ activity }: AgentActivityBubbleProps) {
  return (
    <MessageLayout
      variant="agent"
      avatar={<MessageAvatar kind="agent" name="Prime" agentRole="prime" />}
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
