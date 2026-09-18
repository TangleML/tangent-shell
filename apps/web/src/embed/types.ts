import type {
  Attachment,
  HostResourceInput,
  MessageDelivery,
  Resource,
  ResourceKind,
  ThinkingLevel,
} from "@tangent/shared/contracts";

import type { EmbedApiConfig } from "@/shared/lib/basePath";

/** Host-driven theme inputs. Kept deliberately small (see tech design 6.4). */
export interface EmbedTheme {
  /** `system` follows the host's `prefers-color-scheme`. Defaults to `light`. */
  colorScheme?: "light" | "dark" | "system";
  /**
   * Escape hatch for one-off token overrides, keyed by Tangent's internal
   * custom-property names. Unstable — pins the host to our token names.
   */
  tokens?: Record<string, string>;
}

/** Options for {@link TangentRuntime.newSession}. */
export interface NewSessionOptions {
  /** Session display name; the server defaults to `Session N` when omitted. */
  name?: string;
  /** Initial model for Prime, applied via `agent:set-model` after join. */
  model?: string;
  /** Initial thinking depth for Prime. */
  thinkingDepth?: ThinkingLevel;
  /** Delivery routing for the opening prompt. */
  delivery?: MessageDelivery;
  /** Attachments to send with the opening prompt. */
  attachments?: Attachment[];
  /** Resources to seed the session with, applied before the agent spawns. */
  resources?: HostResourceInput[];
}

export interface NewSessionResult {
  sessionId: string;
}

/** Serializable agent row handed to the host via `open-agent`. */
export interface EmbedAgentPayload {
  id: string;
  name: string;
  kind: "prime" | "subagent";
  status: string;
  conversationId: string;
}

/** Serializable asset row handed to the host via `open-asset`. */
export type EmbedAssetPayload =
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

/** Serializable resource row handed to the host via `open-resource`. */
export interface EmbedResourcePayload {
  id: string;
  kind: ResourceKind;
  name: string;
  uri: string;
  /** The viewable file API url, resolved from `uri` for a `file`/`artifact`. */
  url: string;
  authorParticipantId?: string;
}

/** Serializable mute toggle handed to the host via `toggle-mute`. */
export interface EmbedMuteTogglePayload {
  participantId: string;
  conversationId: string;
  muted: boolean;
}

/** A prompt queued for a session, drained by `<tangent-chat>` once joined. */
export interface PendingPrompt {
  prompt?: string;
  delivery?: MessageDelivery;
  attachments?: Attachment[];
  model?: string;
  thinkingDepth?: ThinkingLevel;
}

/**
 * The shared, module-side object a `<tangent-provider>` owns and its child
 * `<tangent-chat>` resolves. Holds API config, theme inputs, the pending-prompt
 * store, and the `newSession` composition.
 */
export interface TangentRuntime {
  readonly config: EmbedApiConfig;
  readonly theme: EmbedTheme;
  setConfig(config: EmbedApiConfig): void;
  setTheme(theme: EmbedTheme): void;
  subscribeTheme(listener: (theme: EmbedTheme) => void): () => void;
  queuePrompt(sessionId: string, pending: PendingPrompt): void;
  takePendingPrompt(sessionId: string): PendingPrompt | undefined;
  newSession(
    prompt: string,
    bundleId: string,
    options?: NewSessionOptions,
  ): Promise<NewSessionResult>;
  listResources(sessionId: string): Promise<Resource[]>;
  addResource(sessionId: string, input: HostResourceInput): Promise<Resource>;
  removeResource(sessionId: string, uri: string): Promise<void>;
}
