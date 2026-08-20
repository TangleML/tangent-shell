export type ColorScheme = "light" | "dark" | "system";

/** Delivery routing for a prompt, mirroring the server's `MessageDelivery`. */
export type MessageDelivery = "auto" | "steer" | "followUp";

/** What a catalogued resource is, by origin. Mirrors the server's `ResourceKind`. */
export type EmbedResourceKind =
  | "file"
  | "memory"
  | "attachment"
  | "artifact"
  | "host";

/**
 * A catalogued piece of content in a session, as returned to the host. The
 * bytes live elsewhere (a workspace path or a `memory://` / host URI); this is
 * the catalog entry pointing at them.
 */
export interface EmbedResource {
  id: string;
  sessionId: string;
  kind: EmbedResourceKind;
  name: string;
  uri: string;
  authorParticipantId?: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

/**
 * A resource the host may seed at session create or add afterwards. A `memory`
 * entry writes the session (or global) memory store the agent reads; a `host`
 * entry is host-owned content (e.g. a known pipeline) whose `meta` is free-form
 * JSON the shell does not interpret.
 */
export type HostResourceInput =
  | { kind: "memory"; scope?: "session" | "global"; content: string }
  | {
      kind: "host";
      name: string;
      uri: string;
      meta?: Record<string, unknown>;
    };

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
  /**
   * Resources to seed the session with. Applied server-side before the agent
   * spawns, so memory seeds and host entries are standing context from the
   * first turn.
   */
  resources?: HostResourceInput[];
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
  listResources(sessionId: string): Promise<EmbedResource[]>;
  addResource(
    sessionId: string,
    input: HostResourceInput,
  ): Promise<EmbedResource>;
  removeResource(sessionId: string, uri: string): Promise<void>;
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

export interface TangentResourceListElementLike extends HTMLElement {
  sessionId: string;
  agentId: string;
}

export interface TangentParticipantListElementLike extends HTMLElement {
  sessionId: string;
  agentId: string;
}

/** An agent row emitted by `<AgentList onOpen>`. */
export interface EmbedAgent {
  id: string;
  name: string;
  kind: "prime" | "subagent";
  status: string;
  conversationId: string;
}

/** A resource row emitted by `<ResourceList onOpen>`. */
export interface EmbedResourceRow {
  id: string;
  kind: EmbedResourceKind;
  name: string;
  uri: string;
  /** The viewable file API url, resolved for a `file`/`artifact`. */
  url: string;
  authorParticipantId?: string;
}

/** A mute toggle emitted by `<ParticipantList onToggleMute>`. */
export interface EmbedMuteToggle {
  participantId: string;
  conversationId: string;
  muted: boolean;
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
