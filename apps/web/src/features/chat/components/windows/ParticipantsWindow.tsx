import { ParticipantList } from "../sidebar/participants/ParticipantList";
import { useSessionChatWindowsContext } from "./SessionChatWindowsContext";
import { WindowLoadError, WindowSpinner } from "./WindowStatus";

export function ParticipantsWindow() {
  const {
    participants,
    participantsPending,
    participantsError,
    environments,
    activeConversationId,
    currentUserId,
    onToggleMuteParticipant,
    isTogglingMute,
  } = useSessionChatWindowsContext();

  if (participantsPending) return <WindowSpinner />;
  if (participantsError) {
    return (
      <WindowLoadError
        title="Couldn't load participants"
        description="The roster is unavailable right now. It will refresh on its own."
      />
    );
  }

  return (
    <ParticipantList
      participants={participants}
      environments={environments}
      activeConversationId={activeConversationId}
      currentUserId={currentUserId}
      onToggleMute={onToggleMuteParticipant}
      isToggleMutePending={isTogglingMute}
    />
  );
}
