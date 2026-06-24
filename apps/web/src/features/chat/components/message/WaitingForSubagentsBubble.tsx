import { InlineStack } from "@/shared/ui/layout";
import { Spinner } from "@/shared/ui/spinner";
import { Text } from "@/shared/ui/typography";

import { MessageAvatar } from "./MessageAvatar";
import { MessageLayout } from "./MessageLayout";

interface WaitingForSubagentsBubbleProps {
  names: string[];
}

const SPINNER_SIZE = 14;

function waitingLabel(names: string[]): string {
  if (names.length === 1) return `Waiting for ${names[0]}…`;
  return `Waiting for ${names.length} subagents…`;
}

/**
 * Ephemeral bubble shown in Prime's thread while it waits on delegated
 * sub-agents to finish. Mirrors {@link AgentActivityBubble}: it is never
 * persisted and clears as soon as the sub-agents go idle or Prime resumes.
 */
export function WaitingForSubagentsBubble({
  names,
}: WaitingForSubagentsBubbleProps) {
  return (
    <MessageLayout
      variant="agent"
      avatar={<MessageAvatar kind="agent" name="Prime" agentRole="prime" />}
    >
      <InlineStack gap="2" blockAlign="center" wrap="nowrap">
        <Spinner size={SPINNER_SIZE} />
        <Text size="sm" tone="subdued">
          {waitingLabel(names)}
        </Text>
      </InlineStack>
    </MessageLayout>
  );
}
