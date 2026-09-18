import { Text } from "@tangent/ui-primitives/typography";

import { useSessionWorkflow } from "@/features/chat/hooks/useSessionWorkflow";

import { useSessionChatWindowsContext } from "./SessionChatWindowsContext";
import { WindowHeaderContent } from "./WindowHeaderContent";

export function WorkflowWindowHeader() {
  const { sessionId, activeConversationId, participants, currentUserId } =
    useSessionChatWindowsContext();

  const currentParticipant = participants.find(
    (p) => p.id === currentUserId && !p.revokedAt,
  );
  const { data } = useSessionWorkflow(sessionId, {
    conversationId: activeConversationId,
    participantId: currentParticipant?.id,
  });

  const reactors = data?.reactors ?? [];
  const waiting = reactors.filter((r) => !r.ready).length;
  const suffix = waiting > 0 ? waiting : reactors.length;

  return (
    <WindowHeaderContent
      icon="Workflow"
      title="Workflow"
      suffix={
        suffix > 0 ? (
          <Text size="xs" tone="subdued">
            {suffix}
          </Text>
        ) : null
      }
    />
  );
}
