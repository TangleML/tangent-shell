/**
 * Query keys for React Query, following the SessionQueryKeys factory pattern.
 */
export const UserQueryKeys = {
  Me: () => ["me"] as const,
  Permissions: () => ["me", "permissions"] as const,
  Gravatar: (email: string) => ["gravatar", email] as const,
} as const;
