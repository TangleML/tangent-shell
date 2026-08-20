import { PI_AGENT } from "@tangent/shared/contracts";
import { Box } from "@tangent/ui-primitives/box";

import { ParticipantList } from "@/features/chat/components/sidebar/participants/ParticipantList";
import { useSessionChat } from "@/features/chat/hooks/useSessionChat";
import {
  useMuteMembership,
  useSessionParticipants,
} from "@/features/chat/hooks/useSessionParticipants";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";

import type { EmbedMuteTogglePayload } from "../types";

interface EmbeddedParticipantListProps {
  sessionId: string;
  /** The Conversation a mute acts on; defaults to Prime's thread. */
  agentId?: string;
  onToggleMute: (toggle: EmbedMuteTogglePayload) => void;
}

/**
 * The embedded participant list: the session's roster with live presence and a
 * mute toggle for an agent in the active Conversation. The toggle mutates the
 * shared session state and notifies the host, mirroring the Participants window.
 */
export function EmbeddedParticipantList({
  sessionId,
  agentId,
  onToggleMute,
}: EmbeddedParticipantListProps) {
  const chat = useSessionChat(sessionId);
  const activeConversationId = chat.conversationForAgent(
    agentId || PI_AGENT.id,
  );

  const { data: participants = [] } = useSessionParticipants(sessionId);
  const muteMembership = useMuteMembership(sessionId);

  return (
    <ScrollRegion>
      <Box inlineSize="full">
        <ParticipantList
          participants={participants}
          activeConversationId={activeConversationId}
          currentUserId={chat.currentAuthorId}
          onToggleMute={(participantId, conversationId, muted) => {
            muteMembership.mutate({ participantId, conversationId, muted });
            onToggleMute({ participantId, conversationId, muted });
          }}
        />
      </Box>
    </ScrollRegion>
  );
}
