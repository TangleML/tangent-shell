import type { ComponentType, DetailedHTMLProps, HTMLAttributes } from "react";

type TangentElementProps = DetailedHTMLProps<
  HTMLAttributes<HTMLElement> & { instance?: string },
  HTMLElement
>;

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- JSX.IntrinsicElements can only be augmented via namespace
  namespace JSX {
    interface IntrinsicElements {
      "tangent-provider": TangentElementProps;
      "tangent-chat": TangentElementProps;
      "tangent-session-list": TangentElementProps;
      "tangent-artifact-viewer": TangentElementProps;
      "tangent-bundled-ui": TangentElementProps;
      "tangent-agent-list": TangentElementProps;
      "tangent-asset-list": TangentElementProps;
      "tangent-resource-list": TangentElementProps;
      "tangent-participant-list": TangentElementProps;
    }
  }
}

export type ColorScheme = "light" | "dark" | "system";

/**
 * Props a host-owned UI component receives when it replaces a bundle's
 * sandboxed component. Registered by `name` in {@link TangentProviderProps.uiComponents};
 * a matching `tangent-ui:<name>` message block, composer panel, or {@link
 * BundledUISlot} renders it directly in the host's React tree — no Web Worker.
 */
export interface HostUIComponentProps {
  /** The component name it was registered under. */
  name: string;
  /** Which surface it renders on. */
  kind: "message" | "panel";
  /** JSON props (a `message` token's body, or `{}` for a `panel`). */
  props: Record<string, unknown>;
  /** Sends a composed prompt to the chat, as if the user had typed it. */
  onSendPrompt?: (text: string) => void;
  /** Collapses the host message this component renders in (message surface). */
  onCollapse?: () => void;
}

/**
 * Props a host-owned anchor component receives when it renders a custom
 * markdown link protocol. Registered by protocol in {@link
 * TangentProviderProps.anchorProtocols}; a link like `entity://123` renders the
 * mapped component instead of a plain link.
 */
export interface AnchorProtocolProps {
  /** The full href, e.g. `entity://123`. */
  href: string;
  /** The protocol scheme, e.g. `entity` (the map key). */
  protocol: string;
  /** The href remainder after `<protocol>://`, e.g. `123`. */
  path: string;
  /** The link's plain-text label. */
  label: string;
}

/** Host UI components keyed by extension name. */
export type HostUIComponentMap = Record<
  string,
  ComponentType<HostUIComponentProps>
>;

/** Host anchor components keyed by protocol scheme (no `://`). */
export type AnchorProtocolMap = Record<
  string,
  ComponentType<AnchorProtocolProps>
>;

/** The extension keys forwarded to the runtime so it knows which names to slot. */
export interface HostExtensionKeys {
  uiNames: string[];
  anchorProtocols: string[];
}

/** A host-slot record the runtime exposes for the wrapper to fill (see `Chat`). */
export type HostSlotRecordLike =
  | {
      id: string;
      surface: "ui";
      /** Component name to look up in {@link HostUIComponentMap}. */
      key: string;
      props: HostUIComponentProps;
    }
  | {
      id: string;
      surface: "anchor";
      /** Protocol scheme to look up in {@link AnchorProtocolMap}. */
      key: string;
      props: AnchorProtocolProps;
    };

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
  hostExtensions: HostExtensionKeys;
  runtime?: EmbedRuntimeHandle | null;
}

export interface TangentChatElementLike extends HTMLElement {
  sessionId: string;
  agentId?: string;
  initialPrompt?: string;
  /** Current host-slot records to project as light-DOM children. */
  getHostSlots?: () => HostSlotRecordLike[];
  /** Subscribes to host-slot changes; returns an unsubscribe. */
  subscribeHostSlots?: (listener: () => void) => () => void;
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
