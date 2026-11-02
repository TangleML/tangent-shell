export const GlobalExtensionQueryKeys = {
  All: () => ["global-extensions"] as const,
  List: () => [...GlobalExtensionQueryKeys.All(), "list"] as const,
  Marketplaces: () =>
    [...GlobalExtensionQueryKeys.All(), "marketplaces"] as const,
  Search: (id: string, q: string) =>
    [...GlobalExtensionQueryKeys.All(), "search", id, q] as const,
} as const;
