/**
 * Query keys for React Query, following the SessionQueryKeys factory pattern.
 */
export const GlobalMemoryQueryKeys = {
  All: () => ["global-memory"] as const,
} as const;
