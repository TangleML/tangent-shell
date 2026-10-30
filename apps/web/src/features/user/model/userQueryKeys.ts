/**
 * Query keys for React Query, following the SessionQueryKeys factory pattern.
 */
export const UserQueryKeys = {
  Me: () => ["me"] as const,
  Permissions: () => ["me", "permissions"] as const,
} as const;
