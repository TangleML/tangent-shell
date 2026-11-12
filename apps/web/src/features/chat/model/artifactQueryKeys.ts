/**
 * Query keys for an artifact's fetched content, following the SessionQueryKeys
 * factory pattern. Keyed by the artifact's resolved file API URL.
 */
export const ArtifactQueryKeys = {
  Text: (url: string) => ["artifact-text", url] as const,
} as const;
