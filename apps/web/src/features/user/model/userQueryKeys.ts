/**
 * Query keys for React Query, following the SessionQueryKeys factory pattern.
 */
export const UserQueryKeys = {
  Me: () => ["me"] as const,
  Gravatar: (email: string, size: number) =>
    ["gravatar", email, size] as const,
} as const;
