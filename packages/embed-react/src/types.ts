export type ColorScheme = "light" | "dark" | "system";

/** Delivery routing for a prompt, mirroring the server's `MessageDelivery`. */
export type MessageDelivery = "auto" | "steer" | "followUp";

/** Host-driven theme inputs forwarded to `<tangent-provider>`. */
export interface TangentThemeInputs {
  /** `system` follows the host's `prefers-color-scheme`. Defaults to `light`. */
  colorScheme?: ColorScheme;
  /**
   * One-off token overrides keyed by Tangent's internal custom-property names.
   * Unstable escape hatch — pins the host to our token names.
   */
  tokens?: Record<string, string>;
}

/** Options for {@link Tangent.newSession}. */
export interface NewSessionOptions {
  /** Session display name; the server defaults to `Session N` when omitted. */
  name?: string;
  /** Initial model for Prime, applied after the socket joins. */
  model?: string;
  /** Initial thinking depth for Prime (e.g. `off`, `low`, `medium`, `high`). */
  thinkingDepth?: string;
  /** Delivery routing for the opening prompt. */
  delivery?: MessageDelivery;
  /** Attachments to send with the opening prompt. */
  attachments?: unknown[];
}

export interface NewSessionResult {
  sessionId: string;
}

/** The runtime surface `<tangent-provider>` exposes on its DOM element. */
export interface EmbedRuntimeHandle {
  newSession(
    prompt: string,
    bundleId: string,
    options?: NewSessionOptions,
  ): Promise<NewSessionResult>;
}

export interface TangentProviderElementLike extends HTMLElement {
  config: {
    apiBase?: string;
    socketUrl?: string;
    socketPath?: string;
    getToken?: () => string | undefined | Promise<string | undefined>;
  };
  theme: TangentThemeInputs;
  runtime?: EmbedRuntimeHandle | null;
}

export interface TangentChatElementLike extends HTMLElement {
  sessionId: string;
  agentId?: string;
  initialPrompt?: string;
}

export interface TangentSessionListElementLike extends HTMLElement {
  selectedId: string;
}

export interface TangentArtifactViewerElementLike extends HTMLElement {
  sessionId: string;
  url: string;
  title: string;
}

export interface TangentBundledUiElementLike extends HTMLElement {
  moduleUrl: string;
  kind: "message" | "panel";
  props?: Record<string, unknown>;
  stateNamespace?: string;
}

export interface TangentAgentListElementLike extends HTMLElement {
  sessionId: string;
  selectedId: string;
}

export interface TangentAssetListElementLike extends HTMLElement {
  sessionId: string;
  selectedId: string;
}

/** An agent row emitted by `<AgentList onOpen>`. */
export interface EmbedAgent {
  id: string;
  name: string;
  kind: "prime" | "subagent";
  status: string;
  conversationId: string;
}

/** An asset row emitted by `<AssetList onOpen>`. */
export type EmbedAsset =
  | {
      kind: "page" | "file";
      id: string;
      title: string;
      url: string;
      path: string;
    }
  | {
      kind: "trigger";
      id: string;
      title: string;
      triggerKind: string;
      enabled: boolean;
    };
