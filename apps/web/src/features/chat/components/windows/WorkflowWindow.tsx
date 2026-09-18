import { Box } from "@tangent/ui-primitives/box";
import { InlineStack } from "@tangent/ui-primitives/layout";
import { Spinner } from "@tangent/ui-primitives/spinner";

import { useSessionWorkflow } from "@/features/chat/hooks/useSessionWorkflow";
import { EmptyState } from "@/shared/ui/patterns/empty-state";

import { WorkflowList } from "../sidebar/workflow/WorkflowList";
import { useSessionChatWindowsContext } from "./SessionChatWindowsContext";

export function WorkflowWindow() {
  const { sessionId, activeConversationId, participants, currentUserId } =
    useSessionChatWindowsContext();

  const currentParticipant = participants.find(
    (p) => p.id === currentUserId && !p.revokedAt,
  );
  const { data, isPending, isError } = useSessionWorkflow(sessionId, {
    conversationId: activeConversationId,
    participantId: currentParticipant?.id,
  });

  if (isPending) {
    return (
      <Box padding="base">
        <InlineStack fill align="center">
          <Spinner size={20} />
        </InlineStack>
      </Box>
    );
  }

  if (isError || !data) {
    return (
      <Box padding="base">
        <EmptyState
          size="sm"
          title="Couldn't load workflow"
          description="The workflow view is unavailable right now. It will refresh on its own."
        />
      </Box>
    );
  }

  return <WorkflowList workflow={data} participants={participants} />;
}
