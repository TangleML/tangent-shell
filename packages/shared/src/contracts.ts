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
 * The current human's identity, resolved from the Oktasso JWT by `GET /api/me`.
 * The `email` doubles as the user id used when constructing Tangle API requests;
 * `first_name` lets agents address the user by name. Name fields default to an
 * empty string when the JWT omits the corresponding claim.
 */
export interface UserIdentity {
  /** Email; used as the user id for Tangle API requests. */
  email: string;
  first_name: string;
  last_name: string;
}

/**
 * Safety-net identity used when the Oktasso JWT is unavailable (e.g. local
 * development without `AUTH_JWT_TOKEN_COOKIE_NAME` configured). Shared so the
 * server's socket-resolved authorship and the UI's own view of "who am I" land
 * on the same id — a disagreement would render your own messages as somebody
 * else's.
 */
export const DEFAULT_USER: UserIdentity = {
  email: "maxim.ezhov@shopify.com",
  first_name: "John",
  last_name: "Smith",
};

/**
 * The user's short display name: first name plus last-name initial (e.g.
 * `John Smith` -> `John S.`). Falls back to the first name alone, then the
 * email, when name parts are missing.
 */
export function userShortName(user: UserIdentity): string {
  const first = user.first_name.trim();
  const lastInitial = user.last_name.trim().charAt(0).toUpperCase();
  if (first && lastInitial) return `${first} ${lastInitial}.`;
  return first || user.email;
}

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

/** Per-viewer activity summary, derived on the list endpoint, never persisted. */
export interface SessionActivity {
  /** Agent messages written since this user's last view (0 if all seen). */
  unreadCount: number;
  /** ISO-8601 timestamp of the most recent message, if any. */
  lastActivityAt?: string;
  /** Whether any of the session's sub-agents ended in error or was killed. */
  hasError: boolean;
  /** Live sub-agents in the roster, Prime excluded. */
  activeAgentCount: number;
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
  /** The human who created the session, resolved from their Oktasso JWT. */
  user?: UserIdentity;
  /** Whether the session is archived (hidden from the default list). */
  archived: boolean;
  /** Attached by the list endpoint; absent when no viewer is resolved. */
  activity?: SessionActivity;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
}

/** Body of `POST /api/embed/remote-env-token`. */
export interface RemoteEnvTokenRequest {
  sessionId: string;
}

/** Response of `POST /api/embed/remote-env-token`. */
export interface RemoteEnvTokenResponse {
  token: string;
  environmentId: string;
  expiresAt: string;
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
    id: "anthropic/claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
  },
  {
    id: "anthropic/claude-opus-4-8",
    label: "Claude Opus 4.8",
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
 * The chat identity of a human, derived from their resolved {@link
 * UserIdentity}. The email is the author id so "is this my message?" stays
 * stable across reloads. Shared between the server (which resolves authorship
 * from the request's own cookie) and the UI, so there is one definition rather
 * than two that can drift.
 */
export function humanAuthor(user: UserIdentity): ChatAuthor {
  return {
    id: user.email || "local-user",
    kind: "human",
    name: userShortName(user),
  };
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

/**
 * Author attributed to messages the server itself emits into a conversation,
 * such as a message that could not be delivered to its participant. Surfaced in
 * the conversation it concerns so the failure is visible where it happened.
 */
export const SYSTEM_AUTHOR: ChatAuthor = {
  id: "system",
  kind: "agent",
  name: "System",
  agentRole: "prime",
};

/** Which external signal drives a trigger. */
export type TriggerKind = "schedule" | "callback";

/** Whether a trigger came from the installed bundle or was created at runtime. */
export type TriggerSource = "bundle" | "runtime";

/**
 * Where a trigger delivers its prompt: `prime` (the session's Prime agent, the
 * legacy behavior, now discouraged) or `subagent` (a dedicated sub-agent the
 * trigger owns and reacts to in isolation).
 */
export type TriggerTargetKind = "prime" | "subagent";

/**
 * Revival data for a trigger-owned sub-agent. Persisted alongside the trigger so
 * the dedicated sub-agent can be re-spawned from scratch after it dies or the
 * server restarts. Mirrors the fields of a sub-agent spawn request.
 */
export interface TriggerSubagentSpec {
  /** Display name for the sub-agent; defaults to the trigger's title/name. */
  name?: string;
  /** Template to seed tools and system prompt from. */
  template?: string;
  /** Inline system prompt; overrides the template's prompt. */
  systemPrompt?: string;
  /** Inline tool allowlist; overrides the template's tools. */
  tools?: string[];
  /** Inline `provider/model` id; overrides the template/default model. */
  model?: string;
  /** Inline thinking depth; overrides the template/default thinking depth. */
  thinkingDepth?: ThinkingLevel;
}

/**
 * Where a trigger's firings are delivered. A `subagent` target carries the spec
 * needed to revive its dedicated sub-agent plus the id/name of the currently
 * live one (when spawned), so the UI can surface which sub-agent handles it.
 */
export type TriggerTarget =
  | { type: "prime" }
  | {
      type: "subagent";
      spec: TriggerSubagentSpec;
      /** Currently live sub-agent id, if one has been spawned. */
      agentId?: string;
      /** Currently live sub-agent display name, if one has been spawned. */
      agentName?: string;
    };

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
  /** Where the trigger delivers its prompt (Prime or a dedicated sub-agent). */
  target: TriggerTarget;
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

/** What a catalogued resource is: content the session holds, by origin. */
export type ResourceKind =
  | "file"
  | "memory"
  | "attachment"
  | "artifact"
  | "host";

/**
 * A catalogued piece of content in a session — a pinned `artifact`, a human
 * `attachment`, a `memory` document, or a workspace `file` — regardless of
 * which connector or mechanism produced it. The bytes stay where they are; this
 * is the catalog entry that points at them by {@link Resource.uri}.
 */
export interface Resource {
  id: string;
  sessionId: string;
  kind: ResourceKind;
  /** Display name / title. */
  name: string;
  /**
   * Where the content lives: a path relative to the session root (e.g.
   * `artifacts/report.html`) or a `memory://session` / `memory://global`
   * scheme.
   */
  uri: string;
  /** The participant that produced it, when known. */
  authorParticipantId?: string;
  /** Kind-specific facts (e.g. `contentType`, `size`, `scope`). */
  meta?: Record<string, unknown>;
  createdAt: string;
}

/** Response from `GET /api/sessions/:id/resources`. */
export interface ListResourcesResponse {
  resources: Resource[];
}

/**
 * A resource the embed host may seed at session create or add afterwards. A
 * `memory` entry writes the session (or global) memory store the agent reads; a
 * `host` entry is host-owned content (e.g. a known pipeline) whose `meta` is
 * free-form JSON the shell does not interpret.
 */
export type HostResourceInput =
  | { kind: "memory"; scope?: MemoryScope; content: string }
  | {
      kind: "host";
      name: string;
      uri: string;
      meta?: Record<string, unknown>;
    };

/** Response from `POST /api/sessions/:id/resources`: the stored resource. */
export interface AddResourceResponse {
  resource: Resource;
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
  /** Where firings are delivered; defaults to a dedicated sub-agent. */
  target?: TriggerTargetKind;
  /** Sub-agent spec used when `target` is `subagent`. */
  subagent?: TriggerSubagentSpec;
}

/** Payload to update a mutable trigger field. */
export interface UpdateTriggerRequest {
  enabled?: boolean;
  prompt?: string;
  title?: string;
  schedule?: TriggerSchedule;
}

/**
 * Lifecycle status of a sub-agent, surfaced in the session's agent roster.
 *
 * `detached` is the state of a participant that has a place in the roster with
 * nothing behind it — the far end dropped, or the server restarted and has not
 * restored it yet. Distinct from `error` (something went wrong) and from the
 * terminal `completed` / `killed`, and the only non-terminal status a revive or
 * a reattach can move a participant out of.
 */
export type SubagentStatus =
  | "active"
  | "detached"
  | "completed"
  | "killed"
  | "error";

/**
 * The statuses a participant can still be restored from. Everything else is
 * terminal: a `completed`, `killed` or `error`ed participant stays that way, and
 * only these two describe one that ought to have something behind it.
 */
export const RESTORABLE_STATUSES: SubagentStatus[] = ["active", "detached"];

/** Whether a status is one nothing moves a participant out of. */
export function isTerminalStatus(status: SubagentStatus): boolean {
  return !RESTORABLE_STATUSES.includes(status);
}

/**
 * Which transport a connector drives its participant over: `pi-stdio` (a `pi`
 * child process the server owns), `remote-env` (a sub-agent inside a connected
 * remote environment), `external-inbound` (a runtime outside Tangent that
 * streams in over the internal HTTP/SSE API), or `a2a` (an agent reached over
 * the A2A protocol).
 *
 * `unresolved` is the kind of a participant no connector claims. It exists so
 * resolution is total — the server answers with a connector that refuses rather
 * than with `undefined` — and is never persisted or spawned.
 */
export type ConnectorKind =
  | "pi-stdio"
  | "remote-env"
  | "external-inbound"
  | "a2a"
  | "unresolved";

/**
 * Whether Tangent created the participant and is responsible for destroying it
 * (`owned`) or joined one that already existed and outlives the attachment
 * (`attached`).
 */
export type ConnectorLifecycle = "owned" | "attached";

/** Who may create a participant on a connector, if anyone. */
export type SpawnAuthority = "server" | "remote-env" | "bundle-tool" | "none";

/**
 * How a connector's far end proves who it is. Only the scheme is named here:
 * the secret and the check live behind
 * {@link import("../../../apps/server/src/connectors/credentials.ts").ConnectorCredential},
 * server-side, because a credential is not something a client may be told.
 *
 * `inherited-token` and `internal-bearer` are the same server secret differing
 * in issuance — one is handed to a process the server spawns, the other is
 * presented back by a caller that already holds it.
 *
 * `scoped-token` is a short-lived HMAC token minted per session for an embed
 * host connecting as a remote environment. `peer-bearer` runs the other way:
 * the far end sits outside the trust domain and Tangent is the caller, so the
 * secret is presented outbound and no inbound caller ever authenticates under
 * this scheme.
 */
export type CredentialScheme =
  | "inherited-token"
  | "shared-token"
  | "internal-bearer"
  | "minted-secret"
  | "scoped-token"
  | "peer-bearer"
  | "none";

/**
 * The independent facets of the connector behind a participant. These are
 * separate fields rather than one label because they vary independently — the
 * three combinations in the tree today are a coincidence of having only three
 * connectors.
 */
export interface ConnectorDescriptor {
  kind: ConnectorKind;
  lifecycle: ConnectorLifecycle;
  spawnAuthority: SpawnAuthority;
  credentialScheme: CredentialScheme;
  /** The remote environment this participant is bound to, when it has one. */
  environmentId?: string;
  /**
   * Where the far end is reached, for a connector that dials out rather than
   * being dialled. Its sibling: `environmentId` names an environment that
   * connects to Tangent, `endpointUrl` an address Tangent connects to.
   */
  endpointUrl?: string;
}

/**
 * The facets each connector kind runs with today. Adding a connector adds a row
 * here; the facets stay independent fields on {@link ConnectorDescriptor}, so a
 * combination this table does not list is still expressible.
 */
export const CONNECTOR_FACETS: Record<
  ConnectorKind,
  Omit<ConnectorDescriptor, "environmentId">
> = {
  "pi-stdio": {
    kind: "pi-stdio",
    lifecycle: "owned",
    spawnAuthority: "server",
    credentialScheme: "inherited-token",
  },
  "remote-env": {
    kind: "remote-env",
    lifecycle: "owned",
    spawnAuthority: "remote-env",
    credentialScheme: "shared-token",
  },
  "external-inbound": {
    kind: "external-inbound",
    lifecycle: "owned",
    spawnAuthority: "bundle-tool",
    credentialScheme: "internal-bearer",
  },
  a2a: {
    kind: "a2a",
    lifecycle: "attached",
    spawnAuthority: "none",
    credentialScheme: "peer-bearer",
  },
  unresolved: {
    kind: "unresolved",
    lifecycle: "attached",
    spawnAuthority: "none",
    credentialScheme: "none",
  },
};

/**
 * How much of a Conversation a Membership on each connector sees by default.
 * A far end outside Tangent gets `opaque`: it is sent what addresses it, not
 * the log. Declared as data so no membership becomes `shared` by omission.
 */
export const DEFAULT_TRANSCRIPT_VISIBILITY: Record<
  ConnectorKind,
  TranscriptVisibility
> = {
  "pi-stdio": "shared",
  "remote-env": "shared",
  "external-inbound": "opaque",
  a2a: "opaque",
  unresolved: "opaque",
};

/** Builds a connector descriptor, optionally bound to a remote environment. */
export function connectorFor(
  kind: ConnectorKind,
  environmentId?: string,
): ConnectorDescriptor {
  return {
    ...CONNECTOR_FACETS[kind],
    ...(environmentId ? { environmentId } : {}),
  };
}

/** Identifies a single {@link Run}. */
export type RunId = string;

/**
 * Lifecycle of a {@link Run}: `running` while the participant works, then one
 * of three terminal states — it finished (`completed`), it was cancelled by a
 * human or a supervisor (`cancelled`), or it stopped without finishing
 * (`failed`). "Finished its task" and "was stopped" are different facts, so a
 * settled Run keeps which one happened.
 */
export type RunStatus = "running" | "completed" | "cancelled" | "failed";

/**
 * What started a {@link Run}: the participant reacting to a message
 * (`reaction`), a schedule firing (`schedule`), an inbound callback
 * (`webhook`), or a tool call creating work (`tool`). A reaction vocabulary
 * alone cannot describe a schedule or a tool, which is why ingress is its own
 * field.
 */
export type RunIngress = "reaction" | "schedule" | "webhook" | "tool";

/**
 * What a Membership does with a wake that arrives while its participant already
 * has an open {@link Run}. `queue` (the default) lets the wake reach the
 * connector as it does today — a mid-run delivery joins the Run in flight;
 * `coalesce` holds a single latest wake and releases it when the Run settles;
 * `preempt` cancels the Run and delivers; `reject` refuses and emits a cause.
 * Per Membership, so the same agent can queue in one Conversation and preempt
 * in another.
 */
export type AdmissionPolicy = "queue" | "coalesce" | "preempt" | "reject";

/**
 * One unit of work by one participant: what a stream of agent events is
 * attributable to, and what cancellation acts on. Runs are serial per
 * participant — opening one settles whichever Run that participant still had
 * open.
 */
export interface Run {
  id: RunId;
  sessionId: string;
  /** The participant doing the work. */
  participantId: string;
  /** The conversation this Run's messages land in by default. */
  homeConversationId: string;
  status: RunStatus;
  ingress: RunIngress;
  /**
   * The far side's own id for this work, when a connector has one: an Aquifer
   * World session id today, an A2A `Task.id` later.
   */
  externalId?: string;
  /**
   * Connector-private resume cursor for this Run (the Aquifer drain's
   * `lastSeq`), so a far end that streams by cursor has somewhere durable to
   * keep its position.
   */
  cursor?: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
  /** ISO-8601 timestamp the Run settled; absent while it is `running`. */
  endedAt?: string;
}

/**
 * A request awaiting its answer (unified-model §9.4). A Message carrying a
 * `correlationId` opens one; a later Message whose `inReplyTo` names it resolves
 * it. The engine holds the outstanding set — keyed by the asking participant's
 * open {@link Run} when it has one — so "who is blocked on whom" is a listable
 * fact rather than a table inside one connector. It promises an answer will be
 * *identifiable* when it arrives, not that one will arrive: an unanswered
 * correlation expires into a structured cause.
 */
export interface OutstandingCorrelation {
  /** The correlation id, carried by the asking Message and every reply to it. */
  id: string;
  /** The Run the asking participant had open, when one was open. */
  runId?: RunId;
  /** The participant that asked. */
  askedBy: string;
  /** The participant it was addressed to, when the ask named one. */
  askedOf?: string;
  /** The asking Message, when it was opened from a persisted one. */
  messageId?: string;
  /** The Conversation the ask was posted in. */
  conversationId: string;
  /** ISO-8601 timestamp the correlation expires if still unanswered. */
  expiresAt: string;
}

/**
 * A named reaction predicate a Membership can declare:
 * - `always` — act on every Message in the Conversation (self excluded).
 * - `fromHumans` — act only on what a person typed.
 * - `mentionsMe` — act only when addressed. A directed message is one whose
 *   `mentions` include you; `directed` is not a separate value.
 * - `atRunEnd` — act only on a Message that ends its Run.
 * - `never` — a member that declares it does not act.
 */
export type ReactionName =
  | "always"
  | "fromHumans"
  | "mentionsMe"
  | "atRunEnd"
  | "never";

/**
 * A Membership's stored reaction: one or more {@link ReactionName}s joined by
 * `+`, read as a disjunction (`fromHumans+mentionsMe`). Each preset stays
 * atomic; composition lives in the stored value.
 */
export type ReactionSpec = string;

/**
 * A named stateful reaction — a {@link Reactor} with memory across Messages, and
 * across Conversations when its scope spans several. Where a {@link ReactionName}
 * decides from the Message in hand, a Reactor folds a running state and tests it:
 * - `awaitAll` — ready once every named participant (or run) has completed.
 * - `awaitQuorum` — ready once `n` of a named set have completed.
 * - `firstOf` — ready on the first completion from a named set.
 * - `awaitDeadline` — ready when a wall-clock instant passes (single scope only).
 * - `debounce` — ready once a quiet window elapses after the last Message
 *   (single scope only).
 * - `supervise` — ready on the next Message in scope carrying a structured
 *   {@link TerminationCause}, so a supervisor wakes on a failure (§9.7).
 */
export type ReactorName =
  | "awaitAll"
  | "awaitQuorum"
  | "firstOf"
  | "awaitDeadline"
  | "debounce"
  | "supervise";

/**
 * The stored configuration of a {@link ReactorName}. A completion is a Message
 * carrying `endsRun`; `participants` matches it by author id and `runs` by run
 * id, so a caller waits on whichever identity it holds. Serialized as JSON in
 * `reactor_state.spec`.
 */
export type ReactorSpec =
  | { name: "awaitAll"; participants?: string[]; runs?: string[] }
  | { name: "awaitQuorum"; n: number; of: string[] }
  | { name: "firstOf"; participants?: string[]; runs?: string[] }
  | { name: "awaitDeadline"; at: string }
  | { name: "debounce"; windowMs: number }
  | { name: "supervise" };

/**
 * Where a Reactor watches and where its wake lands. `memberships` are the
 * `(conversation, participant)` attachments it folds, all held by the same
 * Participant (the installer). `homeConversationId` is the Conversation the Run
 * it opens belongs to — required, and never inferred from whichever Message
 * completed a set, because that would hand the output thread to whichever worker
 * finished last.
 */
export interface ReactorScope {
  memberships: { conversationId: string; participantId: string }[];
  homeConversationId: string;
}

/**
 * The running state a Reactor folds. Serialized as JSON in `reactor_state.state`,
 * so it is inspectable ("2 of 3") without executing anything — which is what the
 * workflow view later reads. Each shape is discriminated by `kind`:
 * - `await` — the completion ids seen so far (dedup, order-insensitive).
 * - `first` — whether a first completion has fired.
 * - `deadline` — whether the instant has passed.
 * - `debounce` — the last Message's `seq` and whether the quiet window elapsed.
 * - `cause` — whether a Message carrying a structured cause has been observed.
 */
export type ReactorState =
  | { kind: "await"; seen: string[] }
  | { kind: "first"; fired: boolean }
  | { kind: "deadline"; due: boolean }
  | { kind: "debounce"; lastSeq: number; due: boolean }
  | { kind: "cause"; fired: boolean };

/**
 * An installed Reactor as persisted and inspected: its configuration, scope, and
 * current folded state. The row the workflow-view API will later wrap over HTTP.
 */
export interface ReactorRecord {
  id: string;
  sessionId: string;
  /** The Participant this wakes — the installer, holder of every scope membership. */
  participantId: string;
  /** The Conversation the Run it opens belongs to. */
  homeConversationId: string;
  spec: ReactorSpec;
  scope: ReactorScope;
  state: ReactorState;
  createdAt: string;
  updatedAt: string;
}

/**
 * How much of a Conversation a Membership may see. Each label is a preset of the
 * {@link ContextPolicy} the projection engine applies (unified-model §9.6):
 * `shared` is everything verbatim, `opaque` keeps only what addresses the
 * Participant, and `summarized` spends a budget newest-first and digests the
 * rest.
 */
export type TranscriptVisibility = "shared" | "summarized" | "opaque";

/**
 * What the projection does with one Message: keep it as written, fold it into a
 * digest, or drop it entirely. Applied newest-first until the budget is spent
 * (unified-model §9.6).
 */
export type ContextDisposition = "verbatim" | "summarize" | "omit";

/**
 * Who produces the digests the `summarize` band reads from: a Participant id
 * (that Participant authors the digest), `"connector"` for a far end that
 * compacts its own context so Tangent produces none, or `"none"` to omit the
 * band rather than summarize it.
 */
export type ContextSummarizer = string | "connector" | "none";

/**
 * What a Participant's context may cost for one Run. Bounded in characters, not
 * tokens: this layer bounds context, not spend (unified-model §9.9 — "no cost
 * model"), and characters are honest and deterministic to test against.
 */
export interface TokenBudget {
  maxChars: number;
}

/**
 * The kind of a {@link Participant}: a person (`human`), a coding agent
 * (`agent`), or an ingress-driven actor with no interactive presence
 * (`automation`). Kinds describe role only and never placement — a
 * heterogeneous agent reached over A2A is an `agent`, not a distinct kind.
 * Authority rides on {@link Capability}, not on kind.
 */
export type ParticipantKind = "human" | "agent" | "automation";

/**
 * An ability a Participant holds independently of its kind. `orchestrator`
 * grants the spawn/message/list tools and marks the at-most-one Participant a
 * Session directs its sub-agents through. `supervisor` marks a Participant whose
 * Reactor observes structured termination causes and retries, compensates, or
 * escalates (unified-model §9.7) — a capability like `orchestrator`, never a
 * kind. Designation is by capability, not by a reserved id.
 */
export type Capability = "orchestrator" | "supervisor";

/**
 * Whether a Participant is reachable right now: `connected`, `away`, or
 * `detached` — the same "the far end is gone" state 1.4 gave attached
 * connectors. A stored default until presence lifecycle (2.2) makes it live.
 */
export type Presence = "connected" | "away" | "detached";

/**
 * The capabilities an agent's `role` carries. Prime holds `orchestrator` — the
 * successor to `PRIME_AGENT_ID` being a reserved id, so authority reads a
 * capability rather than comparing an id to a constant — and `supervisor`, since
 * today's orchestrator is also the implicit watcher of its workers' failures. A
 * sub-agent holds none. A Session designates at most one orchestrator by
 * convention.
 */
export function capabilitiesForRole(role: AgentRole): Capability[] {
  return role === "prime" ? ["orchestrator", "supervisor"] : [];
}

/**
 * A Participant as returned by the REST surface (`/api/sessions/:id/participants`):
 * the durable actor identity, without the internal `agent_payload` or connector
 * facets. `revokedAt` is set once a person has been removed from the session —
 * the row is kept so its transcript attributions still resolve.
 */
export interface ParticipantView {
  id: string;
  sessionId: string;
  kind: ParticipantKind;
  displayName: string;
  capabilities: Capability[];
  presence: Presence;
  /** ISO-8601 timestamp; set once the Participant has been revoked. */
  revokedAt?: string;
  createdAt: string;
}

/**
 * One of a Participant's Memberships, as returned alongside a
 * {@link ParticipantView}. `muted` is the read of a `reaction` that has been set
 * to `never`, so a client need not know the reaction vocabulary to show it.
 */
export interface MembershipView {
  conversationId: string;
  reaction: ReactionSpec;
  ingress: RunIngress;
  admission: AdmissionPolicy;
  muted: boolean;
}

/**
 * A {@link ParticipantView} with its Memberships inlined, as returned by
 * `GET /api/sessions/:id/participants`. The roster reads this to show who is in
 * the session, their presence, and which Conversations they belong to.
 */
export interface ParticipantWithMemberships extends ParticipantView {
  memberships: MembershipView[];
}

/** Response of `GET /api/sessions/:id/participants`. */
export interface ListParticipantsResponse {
  participants: ParticipantWithMemberships[];
}

/**
 * A serializable snapshot of the {@link ContextPolicy} a Membership's
 * {@link TranscriptVisibility} expands to (unified-model §9.8, "each
 * Participant's ... context policy"). The engine's policy carries a `classify`
 * function that cannot cross the wire; this keeps the parts a reader can act on:
 * the preset it came from, the character budget, and who — if anyone — authors
 * its digests.
 */
export interface ContextPolicyView {
  visibility: TranscriptVisibility;
  budget?: TokenBudget;
  summarizer: ContextSummarizer;
  pinned: string[];
}

/**
 * One Membership as the workflow view reports it: its standing in a Conversation
 * plus the {@link ContextPolicyView} its visibility resolves to. Distinct from
 * {@link MembershipView} (the roster DTO): this pairs a Membership with its
 * policy and names its Participant, where the roster inlines Memberships under a
 * Participant.
 */
export interface WorkflowMembership {
  conversationId: string;
  participantId: string;
  reaction: ReactionSpec;
  ingress: RunIngress;
  admission: AdmissionPolicy;
  policy: ContextPolicyView;
}

/**
 * An installed Reactor's inspectable state (unified-model §9.8, "each Reactor's
 * current `S` and whether `ready` holds"): its config, scope, folded state, and
 * whether it would fire now — read without executing anything, because the
 * engine owns `S`.
 */
export interface WorkflowReactor {
  id: string;
  participantId: string;
  homeConversationId: string;
  spec: ReactorSpec;
  scope: ReactorScope;
  state: ReactorState;
  ready: boolean;
}

/**
 * An open Run as the workflow view reports it (unified-model §9.8, "open Runs,
 * with ingress, home Conversation, admission queue depth and external id"):
 * {@link Run} identity plus how many wakes are held behind it.
 */
export interface WorkflowRun {
  id: string;
  participantId: string;
  homeConversationId: string;
  ingress: RunIngress;
  externalId?: string;
  admissionQueueDepth: number;
}

/**
 * A participant's live reaction chain and the budget it spends against
 * (unified-model §9.8, "the live wave's depth against budget"). `depth` is how
 * far along the chain the participant was last woken; `budget` is the per-chain
 * hop cap.
 */
export interface WorkflowWave {
  participantId: string;
  depth: number;
  budget: number;
}

/**
 * One Participant's projected read of a Conversation, surfaced by the workflow
 * view when it is asked for a specific `(conversation, participant)`: the
 * verbatim tail, the digests standing in for summarized ranges, and the ranges
 * shown as neither. Mirrors the agent-facing room read, plus the `omitted`
 * ranges the projection already computes (unified-model §9.6/§9.8).
 */
export interface WorkflowRoom {
  messages: ChatMessage[];
  digests: Resource[];
  omitted: { fromSeq: number; toSeq: number }[];
}

/**
 * The workflow state of a Conversation (or a whole Session, when no Conversation
 * is named): everything unified-model §9.8 says is derivable from state the
 * model already keeps, folded into one read. Costs nothing to produce because
 * §9.2 made the state a fold and §9.3 put it in the engine.
 */
export interface WorkflowView {
  memberships: WorkflowMembership[];
  reactors: WorkflowReactor[];
  runs: WorkflowRun[];
  waves: WorkflowWave[];
  correlations: OutstandingCorrelation[];
  digests: Resource[];
  causes: TerminationCause[];
  room?: WorkflowRoom;
}

/** Response of `GET /api/sessions/:id/workflow`. */
export interface WorkflowViewResponse {
  workflow: WorkflowView;
}

/** A sub-agent in a session's roster, as tracked for the UI sidebar. */
export interface SubagentInfo {
  /** Stable id; also used as the sub-agent's `ChatAuthor.id`. */
  id: string;
  /**
   * The Conversation this sub-agent's thread lives in — what the client
   * subscribes to and buckets its messages under. Decoupled from {@link
   * SubagentInfo.id}: a fresh id for a sub-agent spawned after 2.4, the agent's
   * own id for a legacy one whose transcript is keyed that way.
   */
  conversationId: string;
  name: string;
  status: SubagentStatus;
  /** The connector that runs the sub-agent. */
  connector: ConnectorDescriptor;
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

/**
 * Where a Message came from, as opposed to who wrote it:
 * - `human` — typed by a person.
 * - `agent` — produced by an agent's run.
 * - `system` — emitted by the server itself (an undeliverable message, a
 *   structured cause).
 * - `relay` — forwarded from another Conversation on a participant's behalf. No
 *   producer yet; the auto-relay paths become this rather than mangling content.
 */
export type MessageSourceKind = "human" | "agent" | "system" | "relay";

/** Provenance of a Message, independent of its {@link ChatAuthor}. */
export interface MessageSource {
  kind: MessageSourceKind;
  /** The participant it originated from, when distinct from the author. */
  from?: string;
  /** The Conversation it was posted from, when it arrived from another. */
  fromConversation?: string;
}

/**
 * Derives a Message's provenance from its author. The write path and the
 * legacy-line adapter in `chatLog.ts` share this, so a message persisted before
 * the envelope existed reads back with the same `source` a new one would get.
 */
export function sourceFromAuthor(author: ChatAuthor): MessageSource {
  if (author.id === SYSTEM_AUTHOR.id) return { kind: "system" };
  return { kind: author.kind };
}

/**
 * Which bound the fan-out engine hit when a cascade stopped: the per-chain hop
 * limit (`wave-depth`) or one Conversation's per-wave reaction budget
 * (`conversation-reactions`).
 */
export type BudgetKind = "wave-depth" | "conversation-reactions";

/**
 * Attribution every {@link TerminationCause} carries so a supervisor can act on
 * it rather than read it: the Membership it happened to (`participantId` in
 * `conversationId`), the {@link Run} involved when one is attributable, and the
 * fan-out wave depth at the point it stopped. A cause a supervisor cannot locate
 * is just a log line (unified-model §9.7).
 */
export interface CauseAttribution {
  /** The Membership's participant. */
  participantId: string;
  /** The Membership's Conversation. */
  conversationId: string;
  /** The Run involved, when one is attributable. */
  runId?: RunId;
  /** The fan-out wave depth where it stopped; `0` when no wave was in flight. */
  waveDepth: number;
}

/**
 * Why an abnormal termination happened, surfaced as a system Message in the
 * Conversation it happened in, at a `seq`, so nothing terminates silently
 * (unified-model §4.4, §9.7). Each variant carries {@link CauseAttribution} so a
 * `supervisor` Participant's Reactor can retry, compensate, or escalate:
 *
 * - `budget-exhausted` — a chain hit its hop limit or a Conversation its per-wave
 *   reaction budget.
 * - `run-error` — a Run settled `failed`.
 * - `connector-detached` — a Participant's connection dropped mid-work.
 * - `admission-rejected` — a wake was refused against an open Run by policy.
 * - `correlation-timeout` — a request expired with no answer.
 * - `wake-refused` — an addressed Participant declined to act.
 */
export type TerminationCause =
  | ({
      kind: "budget-exhausted";
      budget: BudgetKind;
      limit: number;
    } & CauseAttribution)
  | ({ kind: "run-error" } & CauseAttribution)
  | ({ kind: "connector-detached" } & CauseAttribution)
  | ({ kind: "admission-rejected"; policy: AdmissionPolicy } & CauseAttribution)
  | ({
      kind: "correlation-timeout";
      askedBy: string;
      askedOf?: string;
    } & CauseAttribution)
  | ({ kind: "wake-refused" } & CauseAttribution);

/** A single chat message. `content` is markdown. */
export interface ChatMessage {
  id: string;
  sessionId: string;
  /**
   * The Conversation this message belongs to — which transcript the client
   * buckets it into. A Conversation id in its own right, no longer an agent's
   * id: mapped to its owning participant through the `conversations` table, so a
   * thread can outlive or hold more than the one agent it started with.
   */
  conversationId: string;
  /**
   * Position in its Conversation, monotonic from 1 and assigned server-side.
   * Not gap-free: a stream that reserves a `seq` and then fails leaves a hole.
   * Messages persisted before this field existed are numbered from their
   * position in the log on read.
   */
  seq: number;
  author: ChatAuthor;
  /**
   * Participant ids this Message expects to act, resolved from `@name` at write
   * time so nothing downstream has to regex the body. Empty means "posted to
   * the Conversation, addressed to no one in particular".
   */
  mentions: string[];
  /** How the Message came to exist, as opposed to who authored it. */
  source: MessageSource;
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
  /** The {@link Run} that produced this Message, when one is attributable. */
  runId?: RunId;
  /** Whether this Message is the last of its Run. */
  endsRun?: boolean;
  /**
   * Marks this Message as a request awaiting an answer. The engine holds an
   * {@link OutstandingCorrelation} for it until a Message with a matching
   * `inReplyTo` arrives or it times out (unified-model §9.4).
   */
  correlationId?: string;
  /** The `correlationId` this Message answers, when it answers a request. */
  inReplyTo?: string;
  /**
   * The structured reason an abnormal termination happened, when this Message is
   * the system notice of one. Present only on `source.kind: "system"` cause
   * notices; a Reactor observes it to react to a failure (unified-model §9.7).
   */
  cause?: TerminationCause;
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
  bundleId: string;
  /**
   * Resources to seed the session with, applied before the agent spawns so
   * memory seeds and host entries are standing context from the first turn.
   */
  resources?: HostResourceInput[];
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
 * Payload sent by the client to subscribe to one Conversation that appeared
 * after it joined (a newly spawned sub-agent). The server authorizes the
 * subscription against Membership (or session ownership), joins the socket to
 * that Conversation's room, and replies with its history. Conversations present
 * at join time are subscribed server-side, so the client only sends this for
 * ones it learns about later.
 */
export interface ConversationSubscribePayload {
  sessionId: string;
  conversationId: string;
}

/**
 * One Conversation's history, sent in reply to a {@link
 * ConversationSubscribePayload}. Distinct from `chat:history` (the join-time
 * bulk seed of every authorized Conversation) so a late subscription merges one
 * thread's log without disturbing the rest.
 */
export interface ConversationHistoryPayload {
  conversationId: string;
  messages: ChatMessage[];
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

/**
 * Payload sent by the client to post a new chat message. Carries no author: the
 * server resolves the sender from the socket's own identity, so a client cannot
 * claim to be someone else.
 */
export interface ChatMessagePayload {
  sessionId: string;
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
 * `ChatMessage` that the client appends and then fills in via deltas. Its `seq`
 * is already reserved, so the placeholder and the finalized Message that
 * replaces it share one ordinal. `runId` stays beside the message as well,
 * because the delta and error payloads have no message to carry it.
 */
export interface AgentStartPayload {
  message: ChatMessage;
  /** The {@link Run} producing this stream, when one is attributable. */
  runId?: RunId;
}

/** A streamed chunk of the agent's reply, keyed by the message it extends. */
export interface AgentDeltaPayload {
  sessionId: string;
  messageId: string;
  delta: string;
  /** The {@link Run} producing this stream, when one is attributable. */
  runId?: RunId;
}

/** A streamed chunk of the agent's reasoning, keyed by the message it extends. */
export interface AgentThinkingPayload {
  sessionId: string;
  messageId: string;
  delta: string;
  /** The {@link Run} producing this stream, when one is attributable. */
  runId?: RunId;
}

/** Emitted when the agent finishes; carries the final, complete message. */
export interface AgentEndPayload {
  message: ChatMessage;
  /** The {@link Run} producing this stream, when one is attributable. */
  runId?: RunId;
}

/** Emitted when the agent fails to produce (or finish) a reply. */
export interface AgentErrorPayload {
  sessionId: string;
  messageId?: string;
  message: string;
  /** The {@link Run} that failed, when one is attributable. */
  runId?: RunId;
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
  /** The {@link Run} this activity belongs to, when one is attributable. */
  runId?: RunId;
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
  /** The {@link Run} these messages are queued behind, when attributable. */
  runId?: RunId;
}

/** Full sub-agent roster for a session, emitted on join and on reset. */
export interface SubagentRosterPayload {
  sessionId: string;
  subagents: SubagentInfo[];
  /**
   * The orchestrator's home Conversation — the primary ("Prime") thread the UI
   * renders in its main tab. Server-derived from the `orchestrator` capability
   * so the client no longer privileges a reserved `"prime"` id.
   */
  primaryConversationId: string;
}

/** A single sub-agent's spawn or status change. Upserted by `id` on the client. */
export interface SubagentUpdatePayload {
  sessionId: string;
  subagent: SubagentInfo;
}

/**
 * A Participant's live {@link Presence} transition (server -> client): a human
 * connecting, going away, or dropping ("closed laptop"). Broadcast to the
 * session room so a client can show who is currently reachable.
 */
export interface ParticipantPresencePayload {
  sessionId: string;
  participantId: string;
  presence: Presence;
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
 * Sent (client -> server) to cancel a {@link Run}. `conversationId` is the
 * target agent's id (`"prime"` or a sub-agent id), matching how messages are
 * tagged; `runId` names the Run when the client is tracking it, and the server
 * resolves the participant's open Run when it is absent.
 */
export interface AgentAbortPayload {
  sessionId: string;
  conversationId: string;
  /** The {@link Run} to cancel; the server resolves it when omitted. */
  runId?: RunId;
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
  ConversationSubscribe: "conversation:subscribe",
  ConversationHistory: "conversation:history",
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
  ParticipantPresence: "participant:presence",
  MemorySuggestion: "memory:suggestion",
  MemoryConfirm: "memory:confirm",
  MemoryDismiss: "memory:dismiss",
  TriggerRoster: "trigger:roster",
  TriggerUpdate: "trigger:update",
  TriggerRemoved: "trigger:removed",
  ArtifactPin: "artifact:pin",
  ArtifactUnpin: "artifact:unpin",
  ResourcesUpdated: "resources:updated",
  UiCommand: "ui:command",
  SessionStatusSubscribe: "session:status:subscribe",
  SessionStatusSnapshot: "session:status:snapshot",
  SessionStatus: "session:status",
} as const;

export type SocketEvent = (typeof SocketEvents)[keyof typeof SocketEvents];

/**
 * Messages a sandboxed page-preview artifact posts to its host frame via
 * `window.parent.postMessage`. The preview iframe runs at an opaque origin (no
 * `allow-same-origin`), so the host can neither read its DOM nor trust the
 * message origin — it validates by source window instead. The host performs the
 * privileged action on the page's behalf: it carries the deployment's
 * same-origin credentials and re-bases paths onto the proxy mount, so a page
 * cannot reach either by itself. The `tangent:` prefix avoids colliding with
 * framework/library postMessages.
 */
export type PageBridgeMessage =
  | {
      type: "tangent:callback";
      /** Correlates the host's result message back to this request. */
      requestId: string;
      /** Origin-root trigger callback path the page already holds. */
      path: string;
      /** Form fields to submit; defaults to an empty body. */
      body?: Record<string, string>;
      /** Wire encoding; defaults to form-urlencoded. */
      encoding?: "form" | "json";
    }
  | { type: "tangent:openUrl"; url: string };

/** Host's reply to a `tangent:callback` message. */
export interface PageCallbackResult {
  type: "tangent:callback:result";
  requestId: string;
  ok: boolean;
  status: number;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

/** Narrows an untrusted postMessage payload to a {@link PageBridgeMessage}. */
export function isPageBridgeMessage(data: unknown): data is PageBridgeMessage {
  if (typeof data !== "object" || data === null) return false;
  const msg = data as Record<string, unknown>;
  switch (msg.type) {
    case "tangent:callback":
      return (
        typeof msg.requestId === "string" &&
        typeof msg.path === "string" &&
        (msg.body === undefined || isStringRecord(msg.body)) &&
        (msg.encoding === undefined ||
          msg.encoding === "form" ||
          msg.encoding === "json")
      );
    case "tangent:openUrl":
      return typeof msg.url === "string";
    default:
      return false;
  }
}
