/**
 * Query keys for React Query, following the SecretsQueryKeys factory pattern.
 */
export const SessionQueryKeys = {
  All: () => ["sessions"] as const,
  Id: (id: string) => ["sessions", id] as const,
  Resources: (id: string) => ["sessions", id, "resources"] as const,
} as const;
