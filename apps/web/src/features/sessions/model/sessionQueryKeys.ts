/**
 * Query keys for React Query, following the SecretsQueryKeys factory pattern.
 */
export const SessionQueryKeys = {
  All: () => ["sessions"] as const,
  Id: (id: string) => ["sessions", id] as const,
  Resources: (
    id: string,
    scope?: { conversationId?: string; participantId?: string },
  ) =>
    scope?.conversationId && scope.participantId
      ? ([
          "sessions",
          id,
          "resources",
          scope.conversationId,
          scope.participantId,
        ] as const)
      : (["sessions", id, "resources"] as const),
  Participants: (id: string) => ["sessions", id, "participants"] as const,
} as const;
