import { useSessionWorkflow } from "@/features/chat/hooks/useSessionWorkflow";

import { WorkflowList } from "../sidebar/workflow/WorkflowList";
import { useSessionChatWindowsContext } from "./SessionChatWindowsContext";
import { WindowLoadError, WindowSpinner } from "./WindowStatus";

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

  if (isPending) return <WindowSpinner />;
  if (isError || !data) {
    return (
      <WindowLoadError
        title="Couldn't load workflow"
        description="The workflow view is unavailable right now. It will refresh on its own."
      />
    );
  }

  return <WorkflowList workflow={data} participants={participants} />;
}
