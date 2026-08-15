import { ParticipantList } from "../sidebar/participants/ParticipantList";
import { useSessionChatWindowsContext } from "./SessionChatWindowsContext";

export function ParticipantsWindow() {
  const {
    participants,
    activeConversationId,
    currentUserId,
    onToggleMuteParticipant,
  } = useSessionChatWindowsContext();

  return (
    <ParticipantList
      participants={participants}
      activeConversationId={activeConversationId}
      currentUserId={currentUserId}
      onToggleMute={onToggleMuteParticipant}
    />
  );
}
