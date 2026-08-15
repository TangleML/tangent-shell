import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  listParticipants,
  muteMembership,
} from "@/features/sessions/api/sessionsApi";
import { SessionQueryKeys } from "@/features/sessions/model/sessionQueryKeys";

/**
 * The session's roster of Participants (humans, agents, automations), each with
 * their Memberships and live presence. Fetched over REST and kept fresh by
 * invalidating its key from {@link import("./useSessionChat").useSessionChat}
 * whenever a `participant:presence` socket signal arrives.
 */
export function useSessionParticipants(sessionId: string) {
  return useQuery({
    queryKey: SessionQueryKeys.Participants(sessionId),
    queryFn: () => listParticipants(sessionId),
    enabled: sessionId.length > 0,
  });
}

interface MuteMembershipVars {
  participantId: string;
  conversationId: string;
  muted: boolean;
}

/** Mutes/unmutes an agent's Membership, refreshing the roster on success. */
export function useMuteMembership(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      participantId,
      conversationId,
      muted,
    }: MuteMembershipVars) =>
      muteMembership(sessionId, participantId, conversationId, muted),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: SessionQueryKeys.Participants(sessionId),
      });
    },
  });
}
