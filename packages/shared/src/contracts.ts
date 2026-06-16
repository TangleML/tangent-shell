/**
 * Wire contracts shared between the dev server and the web UI.
 *
 * Both `apps/server` and `apps/web` import these from the `@tangent/shared`
 * workspace package so the REST payloads and Socket.IO event shapes never drift
 * between the two sides.
 */

/** Lifecycle status of a session. Phase 1 only ever produces "created". */
export type SessionStatus = "created";

/**
 * Live run status of a session, derived from its Pi process roster on the
 * server and pushed to clients over the socket:
 * - `idle` — no Pi process is running for the session.
 * - `active` — a Pi process is running but no agent is currently working.
 * - `busy` — at least one of the session's agents is mid-run.
 */
export type SessionRunStatus = "idle" | "active" | "busy";

/**
 * Metadata about the Configuration Bundle a session was created from, surfaced
 * so the UI can show which preset a session uses. Derived from the bundle's
 * `tangent.yaml` at install time.
 */
export interface SessionConfigMeta {
  /** The bundle's stable slug id. */
  id: string;
  /** The bundle's human-readable name. */
  name: string;
  /** The bundle author's semver for this preset. */
  version: string;
  /** Relative icon path within the bundle, if any. */
  icon?: string;
}

/**
 * A Pi coding agent session. Each session owns a scoped "root" folder on disk
 * that a Pi worker will eventually run inside (Pi spawn is Phase 2).
 */
export interface Session {
  id: string;
  name: string;
  /** Absolute path to the session's scoped root folder. */
  rootPath: string;
  status: SessionStatus;
  /** Configuration Bundle this session was created from, when applicable. */
  config?: SessionConfigMeta;
  /** Whether the session is archived (hidden from the default list). */
  archived: boolean;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
}

/**
 * Distinguishes the session's orchestrating Prime agent from the sub-agents it
 * spawns. Only present on agent authors. Drives client rendering (e.g. sub-agent
 * replies never carry a thinking process).
 */
export type AgentRole = "prime" | "subagent";

/**
 * Thinking-depth levels accepted by Pi's `--thinking` flag, ordered from no
 * reasoning to the deepest. Surfaced in the UI so a human can tune how hard an
 * agent reasons; `"off"` disables the thinking process entirely.
 */
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * A model the user can assign to an agent. `id` is the `provider/model` string
 * passed straight to Pi's `--model` flag; `provider` mirrors the prefix for
 * display/grouping and `label` is the human-readable name shown in the picker.
 */
export interface ModelOption {
  id: string;
  label: string;
  provider: string;
}

/**
 * Curated set of models offered in the per-agent model picker. Kept small and
 * static; the wire shape lets this later be replaced by a dynamic
 * `pi --list-models` lookup without touching clients. `id` must match a model
 * Pi can resolve through the proxy-provider extension.
 */
export const AVAILABLE_MODELS: ModelOption[] = [
  { id: "openai/gpt-5.5", label: "GPT-5.5", provider: "openai" },
  { id: "openai/gpt-5-mini", label: "GPT-5 Mini", provider: "openai" },
  {
    id: "anthropic/claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    provider: "anthropic",
  },
  {
    id: "anthropic/claude-opus-4-1",
    label: "Claude Opus 4.1",
    provider: "anthropic",
  },
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "google",
  },
];

/**
 * Effective defaults an agent runs when it has no explicit selection. Single
 * source of truth shared by the server's spawn fallback ({@link
 * AVAILABLE_MODELS} `id` form) and the UI, so the picker can show the real
 * default value rather than a generic "Default" label. `DEFAULT_MODEL_ID` is a
 * `provider/model` string matching an {@link AVAILABLE_MODELS} entry.
 */
export const DEFAULT_MODEL_ID = "openai/gpt-5.5";
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";

/** Author of a chat message. Chats assume multiple humans and agents. */
export interface ChatAuthor {
  id: string;
  kind: "human" | "agent";
  name: string;
  /** Only set when `kind` is `"agent"`. */
  agentRole?: AgentRole;
}

/**
 * The session's Prime coding agent. It is the only agent a human talks to and
 * the only one allowed to direct sub-agents. Shared across every session.
 */
export const PI_AGENT: ChatAuthor = {
  id: "prime",
  kind: "agent",
  name: "Prime",
  agentRole: "prime",
};

/**
 * Which memory store a fact belongs to: `session` (this session only, written
 * directly by the agent) or `global` (applies to every session, only mutated on
 * an explicit user request or after the user confirms a suggestion).
 */
export type MemoryScope = "session" | "global";

/**
 * Author attributed to the system-emitted "remembered" highlight messages. The
 * highlight is produced by the server from the actual memory file write (not the
 * agent's narration), so the user always sees ground truth.
 */
export const MEMORY_AUTHOR: ChatAuthor = {
  id: "memory",
  kind: "agent",
  name: "Memory",
  agentRole: "prime",
};

/**
 * Author attributed to prompts a Trigger delivers to Prime. The prompt is the
 * stimulus the agent reacts to (like a human turn), produced by the server from
 * a schedule firing or an inbound callback rather than typed by a person.
 */
export const TRIGGER_AUTHOR: ChatAuthor = {
  id: "trigger",
  kind: "agent",
  name: "Trigger",
  agentRole: "prime",
};

/** Which external signal drives a trigger. */
export type TriggerKind = "schedule" | "callback";

/** Whether a trigger came from the installed bundle or was created at runtime. */
export type TriggerSource = "bundle" | "runtime";

/**
 * Schedule for a `schedule`-kind trigger. Exactly one of `every` / `cron` is
 * meaningful: `every` is a short duration (`"1h"`, `"30m"`, `"45s"`); `cron` is
 * a standard cron expression evaluated server-side.
 */
export interface TriggerSchedule {
  every?: string;
  cron?: string;
}

/**
 * A per-session trigger: turns an external signal into a prompt delivered to
 * Prime. Bundle-declared triggers may carry a compiled transform handler;
 * runtime-created triggers use a prompt template only.
 */
export interface Trigger {
  id: string;
  sessionId: string;
  /** Stable slug, unique within the session. */
  name: string;
  kind: TriggerKind;
  /** Display label; defaults to `name`. */
  title?: string;
  /** Prompt template; supports `{{path}}` interpolation against the signal. */
  prompt?: string;
  /** True when a compiled transform handler exists for this trigger. */
  hasHandler: boolean;
  /** Schedule config, present for `schedule` triggers. */
  schedule?: TriggerSchedule;
  /** Whether the trigger is currently armed. */
  enabled: boolean;
  /** Whether the trigger came from the bundle or was created at runtime. */
  source: TriggerSource;
  /**
   * Relative callback path including the secret (callback triggers only), e.g.
   * `/api/sessions/<id>/triggers/<tid>/callback/<secret>`. External systems POST
   * to it to fire the trigger.
   */
  callbackPath?: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
  /** ISO-8601 timestamp of the most recent firing, if any. */
  lastFiredAt?: string;
}

/**
 * An artifact the user (or an agent) pinned for quick access. Identified by its
 * workspace-relative `path` (e.g. `artifacts/report.html`) so the client can
 * resolve it against the session's file API the same way artifact chips do,
 * independent of any base-prefix the server is unaware of.
 */
export interface PinnedArtifact {
  /** Path relative to the session root, e.g. `artifacts/report.html`. */
  path: string;
  /** Display label for the pinned artifact. */
  title: string;
  /** ISO-8601 timestamp the artifact was pinned. */
  pinnedAt: string;
}

/** Response from `GET /api/sessions/:id/triggers`. */
export interface ListTriggersResponse {
  triggers: Trigger[];
}

/** Payload to create a trigger at runtime (REST or via Prime's tool). */
export interface CreateTriggerRequest {
  name: string;
  kind: TriggerKind;
  title?: string;
  prompt?: string;
  schedule?: TriggerSchedule;
  enabled?: boolean;
}

/** Payload to update a mutable trigger field. */
export interface UpdateTriggerRequest {
  enabled?: boolean;
  prompt?: string;
  title?: string;
  schedule?: TriggerSchedule;
}

/** Lifecycle status of a sub-agent, surfaced in the session's agent roster. */
export type SubagentStatus = "active" | "completed" | "killed" | "error";

/** A sub-agent in a session's roster, as tracked for the UI sidebar. */
export interface SubagentInfo {
  /** Stable id; also used as the sub-agent's `ChatAuthor.id`. */
  id: string;
  name: string;
  status: SubagentStatus;
  /** Template the sub-agent was spawned from, if any. */
  template?: string;
  /** The `provider/model` id this sub-agent runs, when set (else server default). */
  model?: string;
  /** The thinking depth this sub-agent runs, when set (else server default). */
  thinkingDepth?: ThinkingLevel;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

/**
 * A file a human attached to a chat message. Stored inside the session
 * workspace; `path` is workspace-relative so the agent can read it with its own
 * file tools and the file API can serve it over HTTP.
 */
export interface Attachment {
  /** Original filename as uploaded, shown in the UI. */
  name: string;
  /** Path relative to the session root, e.g. `uploads/report.csv`. */
  path: string;
  /** MIME type reported by the browser, when available. */
  contentType?: string;
  /** Size in bytes. */
  size: number;
}

/** A single chat message. `content` is markdown. */
export interface ChatMessage {
  id: string;
  sessionId: string;
  /**
   * The agent process this message belongs to: `"prime"` for the shared
   * human/Prime thread, or a sub-agent's id for that sub-agent's thread. Drives
   * which transcript the client buckets the message into.
   */
  conversationId: string;
  author: ChatAuthor;
  content: string;
  /**
   * The agent's reasoning (markdown), streamed before/alongside `content`.
   * Only present on agent replies that surfaced a thinking process.
   */
  thinking?: string;
  /** Files the human attached to this message, if any. */
  attachments?: Attachment[];
  /**
   * Present on server-emitted "remembered" highlights. Drives the distinct
   * memory bubble (icon + tonal background) and records which store changed.
   */
  memory?: { scope: MemoryScope };
  /** ISO-8601 timestamp. */
  createdAt: string;
}

/**
 * Metadata for an agent bundle stored in the marketplace, derived from the
 * bundle's `tangent.yaml` at upload time. Backs the marketplace grid and the
 * "use in new session" flow.
 */
export interface AgentBundleMeta {
  /** The bundle's stable slug id; also the marketplace storage key. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Author-managed semver for this preset. */
  version: string;
  /** Short description shown on the marketplace card. */
  description?: string;
  /** Bundle author. */
  author?: string;
  /** Free-form tags for filtering/search. */
  tags?: string[];
  /** Whether the bundle shipped a preview icon (served at `/icon`). */
  hasIcon: boolean;
  /** ISO-8601 timestamp the bundle was first saved. */
  createdAt: string;
  /** ISO-8601 timestamp of the most recent upload. */
  updatedAt: string;
  /** UI components this bundle ships (absent when it has none). */
  components?: { name: string; kind: "message" | "panel"; title?: string }[];
}

/** Response from `GET /api/agent-bundles`: the stored bundle metadata. */
export interface ListAgentBundlesResponse {
  bundles: AgentBundleMeta[];
}

export interface CreateSessionRequest {
  name?: string;
  /** Marketplace agent bundle id to create the session from. */
  bundleId?: string;
}

export interface UpdateSessionRequest {
  name?: string;
  archived?: boolean;
}

/** Response from `POST /api/sessions/:id/files`: the stored attachments. */
export interface UploadFilesResponse {
  files: Attachment[];
}

/** Response from `GET /api/global-memory`: the global memory file contents. */
export interface GetGlobalMemoryResponse {
  content: string;
}

/** Request body for `PUT /api/global-memory`: the full file contents to store. */
export interface UpdateGlobalMemoryRequest {
  content: string;
}

/** Response from `PUT /api/global-memory`: the stored file contents. */
export interface UpdateGlobalMemoryResponse {
  content: string;
}

/** Payload sent by the client when joining a session's chat room. */
export interface ChatJoinPayload {
  sessionId: string;
}

/**
 * How a chat message is delivered when its target agent is mid-run:
 * - `"auto"`: normal prompt (queued by Pi as a follow-up only if busy).
 * - `"steer"`: nudge applied after the current tool call, before the next LLM
 *   call (true mid-run steering).
 * - `"followUp"`: queued until the run fully stops.
 * Ignored when the target agent is idle (always sent as a plain prompt).
 */
export type MessageDelivery = "auto" | "steer" | "followUp";

/** Payload sent by the client to post a new chat message. */
export interface ChatMessagePayload {
  sessionId: string;
  author: ChatAuthor;
  content: string;
  /**
   * Target agent's id (`"prime"` or a sub-agent id). Defaults to `"prime"` when
   * omitted, so existing clients keep messaging Prime.
   */
  conversationId?: string;
  /** Mid-run delivery mode for the target agent. Defaults to `"auto"`. */
  delivery?: MessageDelivery;
  /** Files the human attached, already uploaded into the session workspace. */
  attachments?: Attachment[];
}

/** Streamed terminal output from a Pi worker. Reserved/stub for Phase 2. */
export interface TerminalDataPayload {
  sessionId: string;
  chunk: string;
}

/**
 * Emitted when the Pi agent begins a reply. Carries an empty-content
 * `ChatMessage` that the client appends and then fills in via deltas.
 */
export interface AgentStartPayload {
  message: ChatMessage;
}

/** A streamed chunk of the agent's reply, keyed by the message it extends. */
export interface AgentDeltaPayload {
  sessionId: string;
  messageId: string;
  delta: string;
}

/** A streamed chunk of the agent's reasoning, keyed by the message it extends. */
export interface AgentThinkingPayload {
  sessionId: string;
  messageId: string;
  delta: string;
}

/** Emitted when the agent finishes; carries the final, complete message. */
export interface AgentEndPayload {
  message: ChatMessage;
}

/** Emitted when the agent fails to produce (or finish) a reply. */
export interface AgentErrorPayload {
  sessionId: string;
  messageId?: string;
  message: string;
}

/** The kind of work an agent is currently doing, for the ephemeral indicator. */
export type AgentActivityKind = "thinking" | "tool";

/**
 * A transient snapshot of what an agent is doing between (or before) messages.
 * Rendered as an ephemeral spinner bubble and never persisted: it is replaced
 * as soon as the next message streams in, and cleared when the run ends.
 */
export interface AgentActivity {
  kind: AgentActivityKind;
  /** Human-readable description, e.g. "Thinking...", "Running grep". */
  label: string;
  /** The tool being executed, when `kind` is `"tool"`. */
  toolName?: string;
}

/**
 * Emitted as an agent's run-level state changes (start of run, tool calls,
 * between turns). `activity` is `null` when the run is idle or a message is
 * actively streaming (the streaming bubble is the visual in that case).
 */
export interface AgentActivityPayload {
  sessionId: string;
  conversationId: string;
  activity: AgentActivity | null;
}

/**
 * Emitted (server -> client) when an agent's pending message queue changes
 * (steer/follow-up messages added while the agent is mid-run, or drained as the
 * agent processes them). Lets the UI surface pending nudges and clear them once
 * the agent picks them up.
 */
export interface AgentQueuePayload {
  sessionId: string;
  conversationId: string;
  /** Steering messages waiting to be applied before the next LLM call. */
  steering: string[];
  /** Follow-up messages waiting until the run fully stops. */
  followUp: string[];
}

/** Full sub-agent roster for a session, emitted on join and on reset. */
export interface SubagentRosterPayload {
  sessionId: string;
  subagents: SubagentInfo[];
}

/** A single sub-agent's spawn or status change. Upserted by `id` on the client. */
export interface SubagentUpdatePayload {
  sessionId: string;
  subagent: SubagentInfo;
}

/**
 * Emitted (server -> client) when the agent suggests remembering something that
 * needs user confirmation before it is applied (agent-initiated global memory).
 * Rendered as a confirm/dismiss card in the chat.
 */
export interface MemorySuggestionPayload {
  sessionId: string;
  /** Correlates the user's confirm/dismiss back to the pending write. */
  suggestionId: string;
  scope: MemoryScope;
  /** The fact the agent proposes to store. */
  text: string;
}

/** Sent (client -> server) when the user accepts a memory suggestion. */
export interface MemoryConfirmPayload {
  sessionId: string;
  suggestionId: string;
}

/** Sent (client -> server) when the user declines a memory suggestion. */
export interface MemoryDismissPayload {
  sessionId: string;
  suggestionId: string;
}

/** Full trigger roster for a session, emitted on join and on reset. */
export interface TriggerRosterPayload {
  sessionId: string;
  triggers: Trigger[];
}

/** A single trigger's create/update. Upserted by `id` on the client. */
export interface TriggerUpdatePayload {
  sessionId: string;
  trigger: Trigger;
}

/** Emitted when a trigger is deleted. */
export interface TriggerRemovedPayload {
  sessionId: string;
  triggerId: string;
}

/** Sent (client -> server) to pin an artifact for quick access. */
export interface ArtifactPinPayload {
  sessionId: string;
  /** Path relative to the session root, e.g. `artifacts/report.html`. */
  path: string;
  /** Display label for the pinned artifact. */
  title: string;
}

/** Sent (client -> server) to unpin a previously pinned artifact. */
export interface ArtifactUnpinPayload {
  sessionId: string;
  /** Path relative to the session root identifying the artifact to unpin. */
  path: string;
}

/**
 * Sent (client -> server) to abort an agent's in-progress run. `conversationId`
 * is the target agent's id (`"prime"` or a sub-agent id), matching how messages
 * are tagged, so any agent's current work can be cancelled.
 */
export interface AgentAbortPayload {
  sessionId: string;
  conversationId: string;
}

/**
 * Sent (client -> server) to change an agent's model and/or thinking depth.
 * `agentId` is `"prime"` or a sub-agent id. Either field may be omitted to
 * leave that setting unchanged. Applying it respawns the agent's Pi process, so
 * the new settings take effect on subsequent runs.
 */
export interface AgentSetModelPayload {
  sessionId: string;
  agentId: string;
  model?: string;
  thinkingDepth?: ThinkingLevel;
}

/**
 * Emitted (server -> client) with an agent's current model/thinking selection.
 * Used for Prime (whose settings the sub-agent roster does not track) on join
 * and after any change; sub-agent changes ride the existing roster/update
 * events instead.
 */
export interface AgentModelPayload {
  sessionId: string;
  agentId: string;
  model?: string;
  thinkingDepth?: ThinkingLevel;
}

/**
 * A directive an agent issues to influence a session's UI, discriminated by
 * `kind`. This is the single, extensible shape every agent->UI push rides on:
 * new capabilities (theme, panels, windows, ...) add a variant here and a
 * matching client dispatch case, without introducing new socket events.
 */
export type UiCommand =
  | { kind: "session.update"; session: Session }
  | { kind: "artifacts.update"; artifacts: PinnedArtifact[] };
// Future variants, e.g.
//   | { kind: "theme.set"; theme: "light" | "dark" }
//   | { kind: "panel.add"; panel: PanelSpec }
//   | { kind: "window.open"; window: WindowSpec }

/**
 * Envelope broadcast to a session room for an agent->UI directive: `sessionId`
 * routes it to the room; `command` carries the intent. Clients ignore any
 * `command.kind` they don't recognize, so older clients stay forward-compatible
 * as new variants ship.
 */
export interface UiCommandPayload {
  sessionId: string;
  command: UiCommand;
}

/**
 * Emitted (server -> client) when a single session's live run status changes.
 * Broadcast to the shared sessions lobby so list views (the switcher and the
 * sessions table) can reflect status without joining each session's room.
 */
export interface SessionStatusPayload {
  sessionId: string;
  status: SessionRunStatus;
}

/**
 * Full snapshot of non-idle session statuses, sent to a socket right after it
 * subscribes to the lobby. Any session absent from `statuses` is `idle`.
 */
export interface SessionStatusSnapshotPayload {
  statuses: SessionStatusPayload[];
}

/** Socket.IO event names shared by client and server. */
export const SocketEvents = {
  ChatJoin: "chat:join",
  ChatHistory: "chat:history",
  ChatMessage: "chat:message",
  TerminalData: "terminal:data",
  AgentStart: "agent:start",
  AgentDelta: "agent:delta",
  AgentThinking: "agent:thinking",
  AgentEnd: "agent:end",
  AgentError: "agent:error",
  AgentActivity: "agent:activity",
  AgentAbort: "agent:abort",
  AgentSetModel: "agent:set-model",
  AgentModel: "agent:model",
  AgentQueue: "agent:queue",
  SubagentRoster: "subagent:roster",
  SubagentUpdate: "subagent:update",
  MemorySuggestion: "memory:suggestion",
  MemoryConfirm: "memory:confirm",
  MemoryDismiss: "memory:dismiss",
  TriggerRoster: "trigger:roster",
  TriggerUpdate: "trigger:update",
  TriggerRemoved: "trigger:removed",
  ArtifactPin: "artifact:pin",
  ArtifactUnpin: "artifact:unpin",
  UiCommand: "ui:command",
  SessionStatusSubscribe: "session:status:subscribe",
  SessionStatusSnapshot: "session:status:snapshot",
  SessionStatus: "session:status",
} as const;

export type SocketEvent = (typeof SocketEvents)[keyof typeof SocketEvents];
