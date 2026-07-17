export const env = {
  mode: import.meta.env.MODE,
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
  defaultSessionBundleId:
    import.meta.env.VITE_DEFAULT_SESSION_BUNDLE_ID ?? "tangle-oss",
  /**
   * Origin of the Tangle UI host serving the embeddable pipeline editor
   * (`<origin>/embed/editor`). Empty until configured; the Pipeline Editor tab
   * shows a setup hint when unset.
   */
  tangleEmbedUrl: import.meta.env.VITE_TANGLE_EMBED_URL ?? "",
  /**
   * Optional Tangle backend base URL passed to the embed's `init` handshake
   * (`backendUrl`). When empty the editor still boots for in-memory CSOM
   * editing; backend-backed actions (component search, submit) need it set.
   */
  tangleBackendUrl: import.meta.env.VITE_TANGLE_BACKEND_URL ?? "",
} as const;
