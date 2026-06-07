import type { AgentActivity } from "@shared/contracts";

import { InlineStack } from "@/shared/ui/layout";
import { Spinner } from "@/shared/ui/spinner";
import { Text } from "@/shared/ui/typography";

import { MessageBubble } from "./MessageBubble";

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
    <MessageBubble variant="agent">
      <InlineStack gap="2" blockAlign="center" wrap="nowrap">
        <Spinner size={SPINNER_SIZE} />
        <Text size="sm" tone="subdued">
          {activity.label}
        </Text>
      </InlineStack>
    </MessageBubble>
  );
}
