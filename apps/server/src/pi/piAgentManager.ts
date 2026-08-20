import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  type AgentActivity,
  capabilitiesForRole,
  type MessageDelivery,
  RESTORABLE_STATUSES,
  type RunIngress,
  type SessionRunStatus,
  type SessionStatusPayload,
  type SubagentInfo,
  type SubagentStatus,
  type ThinkingLevel,
  type UserIdentity,
} from "@tangent/shared/contracts.ts";

import {
  INTERNAL_URL,
  PI_BIN,
  PI_DEBUG,
  PI_MODEL,
  PI_PROVIDER,
  PI_PROXY_URL,
  PI_THINKING,
} from "../config.ts";
import { piCredential } from "../connectors/credentials.ts";
import type { RunRegistry, SettledStatus } from "../runs/runRegistry.ts";
import type { SessionAgent } from "../store/sessionStore.ts";
import {
  type AgentConfig,
  getPrimeAgentConfig,
  parseThinkingLevel,
  type ResolvedSessionConfig,
  resolveSubagentConfig,
  type SubagentSpawnRequest,
} from "./agentConfig.ts";
import { loadInstalledConfig } from "./config/bundleLoader.ts";
import type { HostResourcePreamble } from "./hostResourcePreamble.ts";
import type { MemoryManager } from "./memory.ts";
import {
  type AgentDescriptor,
  type AgentEvent,
  type AgentProcess,
  type AssistantDelta,
  type ConversationEventSink,
  type PiStdoutEvent,
  PRIME_AGENT_ID,
  type SessionAgents,
} from "./types.ts";
import {
  assistantTextFromMessage,
  attachJsonlReader,
  isAssistantRole,
  MEMORY_EXTENSION,
  ORCHESTRATOR_EXTENSION,
  parsePiEvent,
  PROXY_PROVIDER_EXTENSION,
  readDelta,
  RESOURCES_EXTENSION,
  SESSION_EXTENSION,
  toDescriptor,
  toolActivityLabel,
  toSubagentInfo,
  TRIGGERS_EXTENSION,
} from "./utils.ts";

// Re-exported so existing consumers (sockets, routes, index) keep importing
// these from `piAgentManager.ts` even though they now live in `types.ts`.
export { PRIME_AGENT_ID };
export type {
  AgentDescriptor,
  AgentEvent,
  AgentEventHandler,
  AgentMessageHandler,
  ConversationEventSink,
  SubagentUpdateHandler,
} from "./types.ts";

/**
 * Supervisor retry budget for auto-respawning a crashed Pi process. At most
 * {@link MAX_RESTARTS} respawns are attempted within a rolling
 * {@link RESTART_WINDOW_MS} window (a healthy process that survives past the
 * window resets the count); each attempt waits the matching
 * {@link RESTART_BACKOFF_MS} entry (the last value repeats for further attempts).
 */
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;
const RESTART_BACKOFF_MS = [1_000, 2_000, 4_000];

/** Shared arguments passed to each per-event-type handler in the dispatch table. */
interface EventContext {
  sessionId: string;
  agent: AgentProcess;
  descriptor: AgentDescriptor;
  event: PiStdoutEvent;
}

/**
 * Bundle-supplied capabilities applied to every agent in a session via repeated
 * Pi flags: `--skill`, `--prompt-template`, and extra `--extension`.
 */
interface SpawnExtras {
  skillPaths: string[];
  workflowPaths: string[];
  extensionPaths: string[];
}

/**
 * Joins an agent's base appended system prompt with extra spawn-time preambles
 * (e.g. the current user and the per-session memory), so every agent starts each
 * session aware of that standing context. Empty preambles are dropped.
 */
/** The spawn env's capability list: the role's capabilities, comma-separated. */
function capabilities(role: AgentDescriptor["role"]): string {
  return capabilitiesForRole(role).join(",");
}

function appendPreambles(config: AgentConfig, preambles: string[]): string {
  const extras = preambles.map((preamble) => preamble.trim()).filter(Boolean);
  if (extras.length === 0) return config.appendSystemPrompt;
  return [config.appendSystemPrompt, ...extras].join("\n\n");
}

/**
 * Builds the `## Current user` preamble appended to every agent's system prompt
 * so it knows who it's helping. Returns an empty string for unauthenticated
 * sessions so {@link appendPreambles} drops it.
 */
function buildUserPreamble(user: UserIdentity | undefined): string {
  if (!user) return "";

  const fullName = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const who = fullName ? `${fullName} (${user.email})` : user.email;

  const lines = ["## Current user", "", `You are assisting ${who}.`];
  if (user.first_name) {
    lines.push(
      `Address them by their first name (${user.first_name}) when it reads naturally.`,
    );
  }
  lines.push(
    `Use their email (${user.email}) as the user id when constructing Tangle API requests (filters, annotations, attribution).`,
    "Do not ask the user to identify themselves.",
  );
  return lines.join("\n");
}

/**
 * Result of {@link PiAgentManager.spawnSubagent}: the wire {@link SubagentInfo}
 * plus the resolved spawn details a caller needs to persist for a faithful
 * revive (the full tool allowlist, the appended system prompt, and whether the
 * sub-agent's replies auto-relay back to Prime).
 */
export interface SpawnedSubagent {
  info: SubagentInfo;
  /** Resolved tool allowlist the process was spawned with. */
  tools: string[];
  /** Resolved appended system prompt the process was spawned with. */
  systemPrompt: string;
  /** Whether the sub-agent's finalized replies auto-relay back to Prime. */
  autoRelayToPrime: boolean;
}

/** One message to deliver to one agent's stdin. */
export interface SendToAgentOptions {
  sessionId: string;
  agentId: string;
  text: string;
  /** Whether a mid-run message steers or queues. Defaults to `auto`. */
  delivery?: MessageDelivery;
  /** What the message counts as if it opens a Run. Defaults to `reaction`. */
  ingress?: RunIngress;
}

/** A requested model/thinking change; either field may be omitted to keep it. */
export interface AgentModelSelection {
  model?: string;
  thinkingDepth?: ThinkingLevel;
}

/**
 * Returns a copy of `config` with the selection's model/thinking applied. An
 * `undefined` field leaves the existing value untouched, so a change can target
 * just the model or just the thinking depth.
 */
function withModelSelection(
  config: AgentConfig,
  selection: AgentModelSelection | undefined,
): AgentConfig {
  if (!selection) return config;
  return {
    ...config,
    model: selection.model ?? config.model,
    thinkingDepth: selection.thinkingDepth ?? config.thinkingDepth,
  };
}

/** Effective provider/model/thinking for a spawn, with server-default fallback. */
interface ModelArgs {
  provider: string;
  model: string;
  thinking: string;
}

/**
 * Splits a selected model id into provider + model. A `provider/id` value
 * carries its own provider; a bare id keeps the server default provider, and an
 * empty/unset value falls back to the server default model.
 */
function splitModel(selected: string | undefined): {
  provider: string;
  model: string;
} {
  if (selected && selected.includes("/")) {
    const slash = selected.indexOf("/");
    return {
      provider: selected.slice(0, slash),
      model: selected.slice(slash + 1),
    };
  }
  return { provider: PI_PROVIDER, model: selected || PI_MODEL };
}

/**
 * Resolves an agent's effective `--provider`/`--model`/`--thinking`, falling
 * back to the server defaults ({@link PI_MODEL} / {@link PI_THINKING}).
 */
function resolveModelArgs(config: AgentConfig): ModelArgs {
  const { provider, model } = splitModel(config.model?.trim());
  return { provider, model, thinking: config.thinkingDepth ?? PI_THINKING };
}

/** Builds the `pi --mode rpc` CLI args for an agent process. */
function buildPiArgs(
  config: AgentConfig,
  extras: SpawnExtras,
  preambles: string[],
): string[] {
  const { provider, model, thinking } = resolveModelArgs(config);
  const args = [
    "--mode",
    "rpc",
    "--no-session",
    // Disable Pi's skill auto-discovery (~/.pi/agent/skills, project .pi/skills)
    // so only bundle-provided --skill paths load. Matches the container where
    // HOME=/tmp leaves nothing to discover.
    "--no-skills",
    "--provider",
    provider,
    "--model",
    model,
    "--thinking",
    thinking,
    "--tools",
    config.tools.join(","),
    "--append-system-prompt",
    appendPreambles(config, preambles),
    // Orchestrator gives Prime its sub-agent tools; the proxy-provider
    // extension registers Pi's providers against the LLM proxy (required in
    // environments without an auto-discovered `~/.pi/agent` config); the memory
    // extension registers the read/remember tools; the resources extension
    // registers read_resources; the triggers extension gives Prime its
    // create/list/enable/disable/delete trigger tools; the session extension
    // gives Prime its rename_session tool.
    "--extension",
    ORCHESTRATOR_EXTENSION,
    "--extension",
    PROXY_PROVIDER_EXTENSION,
    "--extension",
    MEMORY_EXTENSION,
    "--extension",
    RESOURCES_EXTENSION,
    "--extension",
    TRIGGERS_EXTENSION,
    "--extension",
    SESSION_EXTENSION,
  ];

  // Bundle-provided skills, workflows, and custom tool extensions, applied to
  // every agent in the session so they share the bundle's capabilities.
  const flagged: Array<[string, string[]]> = [
    ["--skill", extras.skillPaths],
    ["--prompt-template", extras.workflowPaths],
    ["--extension", extras.extensionPaths],
  ];
  for (const [flag, paths] of flagged) {
    for (const value of paths) args.push(flag, value);
  }

  return args;
}

/** Warns once-per-spawn when the LLM proxy env vars are unset. */
function warnMissingProxyEnv(): void {
  if (!process.env.PI_PROXY_API_KEY) {
    console.warn(
      "[pi] PI_PROXY_API_KEY is not set; Pi will fail to reach the LLM gateway. " +
        "Run `export PI_PROXY_API_KEY=$(devx llm-gateway print-token --key)` before starting the server.",
    );
  }
  if (!process.env.PI_PROXY_URL) {
    console.warn(
      `[pi] PI_PROXY_URL is not set; the proxy-provider extension will default to ${PI_PROXY_URL}. ` +
        "Set PI_PROXY_URL to point Pi at a different LLM proxy.",
    );
  }
}

/**
 * Resolves the config a (re)spawn should use: a caller-supplied config wins
 * (fresh install), then the session's already-captured config, and finally —
 * on a revive where neither is present — the bundle re-resolved from the
 * installed `.tangent/` tree on disk. `undefined` (a plain session) lets the
 * caller fall back to the global default.
 */
function resolveEffectiveConfig(
  config: ResolvedSessionConfig | undefined,
  existing: SessionAgents | undefined,
  rootPath: string,
): ResolvedSessionConfig | undefined {
  if (config) return config;
  if (existing?.config) return existing.config;
  try {
    return loadInstalledConfig(rootPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[pi] failed to load installed bundle config for "${rootPath}"; using default config. ${message}`,
    );
    return undefined;
  }
}

/**
 * A persisted roster row is eligible for revive when it is a sub-agent (Prime is
 * handled by {@link PiAgentManager.ensure}) that is not terminal and isn't
 * already live in the in-memory roster, so a reconnect won't double-spawn it.
 * `detached` is the ordinary pre-revive state — the boot reconciliation puts
 * every stale row there — so excluding it would stop revive working at all.
 *
 * Which transport a row belongs to is not asked here: {@link
 * import("../connectors/connectorRegistry.ts").ConnectorRegistry.revive} routes
 * each row to its own connector, so only rows this manager owns arrive.
 */
function canReviveSubagent(
  session: SessionAgents,
  agent: SessionAgent,
): boolean {
  if (agent.role !== "subagent") return false;
  if (!RESTORABLE_STATUSES.includes(agent.status)) return false;
  return !session.agents.has(agent.id);
}

/** The environment a spawned Pi process inherits, tagging it with its session. */
function spawnEnv(
  sessionId: string,
  descriptor: AgentDescriptor,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TANGENT_SESSION_ID: sessionId,
    TANGENT_AGENT_ID: descriptor.agentId,
    TANGENT_AGENT_ROLE: descriptor.role,
    // Gates the extension's orchestration-tool grant on capability, not role.
    TANGENT_AGENT_CAPABILITIES: capabilities(descriptor.role),
    TANGENT_INTERNAL_URL: INTERNAL_URL,
    ...piCredential.spawnEnv(),
  };
}

/** Extracts the per-agent {@link SpawnExtras} from a session's bundle config. */
function spawnExtras(config: ResolvedSessionConfig | undefined): SpawnExtras {
  if (!config) {
    return { skillPaths: [], workflowPaths: [], extensionPaths: [] };
  }
  return {
    skillPaths: config.skillPaths,
    workflowPaths: config.workflowPaths,
    extensionPaths: config.extensionPaths,
  };
}

/** Logs the resolved spawn configuration (with the proxy key masked). */
function logSpawn(
  sessionId: string,
  descriptor: AgentDescriptor,
  cwd: string,
  config: AgentConfig,
  extras: SpawnExtras,
): void {
  const { provider, model, thinking } = resolveModelArgs(config);
  console.log(
    `[pi:${sessionId}:${descriptor.agentId}] spawning`,
    JSON.stringify({
      bin: PI_BIN,
      role: descriptor.role,
      cwd,
      provider,
      model,
      thinking,
      proxyUrl: PI_PROXY_URL,
      hasProxyApiKey: Boolean(process.env.PI_PROXY_API_KEY),
      tools: config.tools.join(","),
      skills: extras.skillPaths,
      workflows: extras.workflowPaths,
      extensions: extras.extensionPaths,
    }),
  );
}

/**
 * Logs a single stdout RPC line. Raw lines are emitted only under PI_DEBUG;
 * error-shaped events are always surfaced (the key signal when an agent fails
 * to generate a response), and otherwise the event type is logged.
 */
function logStdoutLine(
  sessionId: string,
  agentId: string,
  line: string,
  event: PiStdoutEvent | null,
): void {
  const tag = `[pi:${sessionId}:${agentId}]`;
  if (PI_DEBUG) console.log(`${tag} stdout ${line}`);
  if (!event) return;

  const isError = typeof event.type === "string" && /error/i.test(event.type);
  if (isError) {
    console.error(`${tag} error event: ${line}`);
  } else if (!PI_DEBUG) {
    console.log(`${tag} event ${event.type}`);
  }
}

/** Coerces an unknown Pi `queue_update` field into a string array, dropping
 * non-string entries so a malformed line can't crash the relay. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * How a Run settles when its participant is killed: a graceful, Prime-initiated
 * finish completed the work; anything else stopped it short.
 */
function settledForKill(completed: boolean): SettledStatus {
  return completed ? "completed" : "cancelled";
}

/**
 * Maps a delivery mode to Pi's `streamingBehavior` for a mid-run message: only
 * an explicit steer nudges before the next LLM call; everything else (including
 * `"auto"`) queues as a follow-up so nothing is dropped.
 */
function busyStreamingBehavior(
  delivery: MessageDelivery,
): "steer" | "followUp" {
  return delivery === "steer" ? "steer" : "followUp";
}

/**
 * Manages a roster of long-lived `pi --mode rpc` child processes per session:
 * one Prime agent plus the sub-agents Prime spawns at runtime.
 *
 * Every process runs inside the session's scoped root folder and loads the
 * orchestrator extension, which gives Prime tools to spawn/message/kill
 * sub-agents (and every agent a tool to read the shared room transcript). Those
 * tools call back into this server's internal API, so the manager stays the
 * single authority over process lifecycle. Streaming events are parsed from
 * stdout and relayed to the chat layer, tagged with the producing agent.
 */
export class PiAgentManager {
  private readonly sessions = new Map<string, SessionAgents>();
  private readonly handlers: ConversationEventSink;
  private readonly memory: MemoryManager;
  /**
   * The Runs this manager's agents work under. Pi is the authority on its own
   * run boundaries (`agent_start` opens, `agent_end` settles), so it opens and
   * settles them rather than having them inferred from the event stream.
   */
  private readonly runs: RunRegistry;
  /**
   * Spawn-time projection of each session's host resources, appended to every
   * agent's preamble. Optional so a bare manager (e.g. a test) skips it.
   */
  private readonly hostResources?: HostResourcePreamble;
  /**
   * Process launcher, injectable so tests can supply a fake child without
   * spawning a real `pi` binary. Defaults to Node's {@link spawn}.
   */
  private readonly spawnProcess: typeof spawn;
  /**
   * Last run status emitted per session, so {@link notifyStatus} only fires the
   * handler when the status actually changes (busy flags toggle frequently).
   */
  private readonly lastStatus = new Map<string, SessionRunStatus>();

  constructor(
    handlers: ConversationEventSink,
    memory: MemoryManager,
    runs: RunRegistry,
    hostResources?: HostResourcePreamble,
    spawnProcess: typeof spawn = spawn,
  ) {
    this.spawnProcess = spawnProcess;
    this.handlers = handlers;
    this.memory = memory;
    this.runs = runs;
    this.hostResources = hostResources;
  }

  /**
   * Relays an agent event, attributed to the Run its participant is working
   * under. The single stamping point, so no emit site can forget attribution.
   */
  private emit(
    sessionId: string,
    descriptor: AgentDescriptor,
    event: AgentEvent,
  ): void {
    const runId = this.runs.current(sessionId, descriptor.agentId)?.id;
    this.handlers.onAgentEvent(sessionId, descriptor, { ...event, runId });
  }

  /**
   * Computes a session's live run status from its process roster: `idle` when
   * no Pi process is running, `busy` when any agent is mid-run, else `active`.
   */
  computeStatus(sessionId: string): SessionRunStatus {
    const session = this.sessions.get(sessionId);
    if (!session || session.agents.size === 0) return "idle";
    for (const agent of session.agents.values()) {
      if (agent.busy) return "busy";
    }
    return "active";
  }

  /**
   * Snapshot of every non-idle session's status, for seeding a socket that just
   * subscribed to the lobby. Sessions absent from the result are `idle`.
   */
  getStatuses(): SessionStatusPayload[] {
    const statuses: SessionStatusPayload[] = [];
    for (const sessionId of this.sessions.keys()) {
      const status = this.computeStatus(sessionId);
      if (status !== "idle") statuses.push({ sessionId, status });
    }
    return statuses;
  }

  /**
   * Recomputes a session's status and relays it to the lobby only when it
   * changed since the last emit. Called after every busy/lifecycle transition.
   */
  private notifyStatus(sessionId: string): void {
    const status = this.computeStatus(sessionId);
    if (this.lastStatus.get(sessionId) === status) return;
    if (status === "idle") {
      this.lastStatus.delete(sessionId);
    } else {
      this.lastStatus.set(sessionId, status);
    }
    this.handlers.onSessionStatus(sessionId, status);
  }

  /**
   * Spawns the session's Prime process if it isn't already running. When a
   * `config` (resolved from a Configuration Bundle) is supplied on first
   * creation, it is captured on the session and drives every agent's spawn;
   * later calls without a config keep the captured one.
   *
   * On a revive (e.g. after a server restart, where the in-memory roster is
   * empty and callers no longer carry the config), the bundle config is
   * re-resolved from the installed `.tangent/` tree so the respawned process
   * receives exactly the same configuration the session was created with —
   * Prime's prompt/tools, sub-agent templates/defaults, and skill/workflow/
   * extension paths — rather than silently falling back to the global default.
   */
  ensure(
    sessionId: string,
    rootPath: string,
    config?: ResolvedSessionConfig,
    primeOverride?: AgentModelSelection,
    user?: UserIdentity,
    homeConversationId: string = PRIME_AGENT_ID,
  ): void {
    const existing = this.sessions.get(sessionId);
    if (existing?.agents.has(PRIME_AGENT_ID)) return;

    warnMissingProxyEnv();

    // Prepare memory before the first spawn so the preamble reflects any
    // bundle-seeded session memory and the current global store.
    this.memory.initSession(rootPath);

    const effectiveConfig = resolveEffectiveConfig(config, existing, rootPath);
    const session = this.upsertSessionRecord(
      sessionId,
      rootPath,
      effectiveConfig,
      user,
    );
    const primeConfig = session.config?.prime ?? getPrimeAgentConfig();
    this.spawnAgent(
      sessionId,
      session,
      {
        agentId: PRIME_AGENT_ID,
        role: "prime",
        name: "Prime",
        homeConversationId,
      },
      withModelSelection(primeConfig, primeOverride),
    );
  }

  /**
   * Re-spawns one persisted sub-agent after a restart (when the in-memory roster
   * holds only Prime). The process comes back with the exact config it was
   * spawned with (tools, appended system prompt, model/thinking, template,
   * auto-relay), but its original task is deliberately NOT re-delivered: Pi is
   * ephemeral (`--no-session`), so the revived process starts idle and Prime
   * decides — from the transcript and session memory — whether to re-task it.
   *
   * No-op for a session whose Prime isn't ensured yet, for an agent that is
   * already live (so a reconnect doesn't double-spawn), and for a terminal row.
   */
  reviveSubagent(sessionId: string, agent: SessionAgent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (!canReviveSubagent(session, agent)) return;

    const revived = this.spawnAgent(
      sessionId,
      session,
      {
        agentId: agent.id,
        role: "subagent",
        name: agent.name,
        template: agent.template,
        homeConversationId: agent.homeConversationId,
        autoRelayToPrime: agent.autoRelayToPrime ?? true,
      },
      this.reconstructSubagentConfig(session, agent),
    );
    this.handlers.onSubagentUpdate(sessionId, toSubagentInfo(revived));
  }

  /**
   * Rebuilds a persisted sub-agent's spawn config. Prefers the persisted tools +
   * system prompt (a faithful, inline-safe restore); falls back to re-resolving
   * from the session's templates/defaults for rows persisted before those fields
   * were stored.
   */
  private reconstructSubagentConfig(
    session: SessionAgents,
    agent: SessionAgent,
  ): AgentConfig {
    const thinkingDepth = parseThinkingLevel(agent.thinkingDepth);
    if (agent.tools && agent.systemPrompt !== undefined) {
      return {
        tools: agent.tools,
        appendSystemPrompt: agent.systemPrompt,
        model: agent.model,
        thinkingDepth,
      };
    }

    return resolveSubagentConfig(
      {
        name: agent.name,
        template: agent.template,
        model: agent.model,
        thinkingDepth,
      },
      {
        templates: session.config?.templates,
        defaults: session.config?.subagentDefaults,
      },
    );
  }

  /**
   * Returns the in-memory roster record for a session, creating it on first
   * access. Identity and config are backfilled on a re-spawn (e.g. after a
   * server restart) when the caller supplies the persisted user or a recovered
   * config but the existing record predates them; an already-captured config is
   * otherwise left untouched.
   */
  private upsertSessionRecord(
    sessionId: string,
    rootPath: string,
    config: ResolvedSessionConfig | undefined,
    user: UserIdentity | undefined,
  ): SessionAgents {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (user && !existing.user) existing.user = user;
      if (config && !existing.config) existing.config = config;
      return existing;
    }

    const created: SessionAgents = {
      rootPath,
      agents: new Map(),
      config,
      user,
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  /**
   * Changes an agent's model and/or thinking depth and respawns its Pi process
   * so the new settings apply to subsequent runs. Pi is ephemeral
   * (`--no-session`), so the in-flight conversation context is dropped and any
   * running turn is aborted. Returns the agent's new selection (for the caller
   * to persist/broadcast), or `undefined` if the agent is unknown.
   */
  setAgentModel(
    sessionId: string,
    agentId: string,
    selection: AgentModelSelection,
  ): { role: AgentProcess["role"]; info: SubagentInfo } | undefined {
    const session = this.sessions.get(sessionId);
    const existing = session?.agents.get(agentId);
    if (!session || !existing) return undefined;

    const descriptor: AgentDescriptor & { template?: string } = {
      agentId: existing.agentId,
      role: existing.role,
      name: existing.name,
      template: existing.template,
      homeConversationId: existing.homeConversationId,
    };
    const nextConfig = withModelSelection(existing.config, selection);

    // Quiet the outgoing process so its kill-triggered exit handler doesn't
    // emit a spurious in-flight error for the run we're intentionally cutting,
    // and mark the kill intentional so the supervisor doesn't auto-respawn it
    // (we immediately respawn it below with the new settings).
    existing.busy = false;
    existing.currentMessageId = null;
    existing.aborted = true;
    existing.intentionalKill = true;
    existing.child.kill();
    // The killed process will never emit `agent_end`, so settle here: the turn
    // we cut was stopped, not finished.
    this.runs.settleOpenFor(sessionId, agentId, "cancelled");

    const agent = this.spawnAgent(sessionId, session, descriptor, nextConfig);
    const info = toSubagentInfo(agent);
    if (agent.role === "subagent") {
      this.handlers.onSubagentUpdate(sessionId, info);
    }
    return { role: agent.role, info };
  }

  /**
   * Spawns a sub-agent for the session and returns its roster entry. The
   * session's Prime must already exist. An initial task is not delivered here:
   * it is a Message posted into the new sub-agent's Conversation, which is what
   * both surfaces it and wakes the sub-agent.
   */
  spawnSubagent(
    sessionId: string,
    request: SubagentSpawnRequest,
  ): SpawnedSubagent {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`No active session for ${sessionId}`);
    }

    const agentId = randomUUID();
    // Mint the sub-agent's Conversation up front so its roster update — and the
    // subscribe the client makes off it — already carry a Conversation id that
    // is not the agent's id. The store persists this mapping on `recordAgent`.
    const homeConversationId = randomUUID();
    const config = resolveSubagentConfig(request, {
      templates: session.config?.templates,
      defaults: session.config?.subagentDefaults,
    });
    const autoRelayToPrime = request.autoRelayToPrime ?? true;

    const agent = this.spawnAgent(
      sessionId,
      session,
      {
        agentId,
        role: "subagent",
        name: request.name,
        template: request.template,
        homeConversationId,
        autoRelayToPrime,
      },
      config,
    );

    const info = toSubagentInfo(agent);
    this.handlers.onSubagentUpdate(sessionId, info);

    return {
      info,
      tools: [...config.tools],
      systemPrompt: config.appendSystemPrompt,
      autoRelayToPrime,
    };
  }

  /**
   * Delivers a message to a specific agent's stdin. If that agent is already
   * streaming, the message is queued: `delivery: "steer"` applies it after the
   * current tool call (before the next LLM call), while `"followUp"` (and the
   * `"auto"` default) waits until the run fully stops. The default preserves
   * the original behavior so nothing is dropped.
   *
   * A message that finds the agent idle opens a Run with `ingress`; one that
   * finds it mid-run joins the Run in flight, because Pi folds a steer or
   * follow-up into the turn it is already taking.
   */
  sendToAgent(options: SendToAgentOptions): void {
    const { sessionId, agentId, text } = options;
    const agent = this.sessions.get(sessionId)?.agents.get(agentId);
    if (!agent) {
      // No participant, so no Run: this error belongs to no unit of work. With
      // no roster row there is no home Conversation to resolve, so the error is
      // tagged with the agent's id (its legacy home) as a best effort.
      this.handlers.onAgentEvent(
        sessionId,
        {
          agentId,
          role: "prime",
          name: "Prime",
          homeConversationId: agentId,
        },
        { type: "error", message: `Agent ${agentId} is not available.` },
      );
      return;
    }

    if (!agent.busy) {
      const ingress = options.ingress ?? "reaction";
      this.runs.open({
        sessionId,
        participantId: agentId,
        homeConversationId: agent.homeConversationId,
        ingress,
      });
    }

    this.writePrompt(sessionId, agent, text, options.delivery ?? "auto");
    this.notifyStatus(sessionId);
  }

  /**
   * Writes a prompt to an agent's stdin, marking it busy. A prompt that arrives
   * mid-stream carries a `streamingBehavior` (steer / follow-up); that field is
   * only valid while streaming, so an idle agent gets a plain prompt.
   */
  private writePrompt(
    sessionId: string,
    agent: AgentProcess,
    text: string,
    delivery: MessageDelivery,
  ): void {
    const wasBusy = agent.busy;
    const command: Record<string, unknown> = {
      id: randomUUID(),
      type: "prompt",
      message: text,
      ...(wasBusy
        ? { streamingBehavior: busyStreamingBehavior(delivery) }
        : {}),
    };

    console.log(
      `[pi:${sessionId}:${agent.agentId}] prompt`,
      JSON.stringify({
        role: agent.role,
        wasBusy,
        delivery,
        textLength: text.length,
      }),
    );

    agent.busy = true;
    agent.child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  /**
   * Cancels a participant's in-progress Run by sending Pi's `abort` RPC command
   * on stdin. The process stays alive and emits `agent_end`, which settles the
   * Run as `cancelled` and resets state through the normal event flow. Returns
   * false when there is nothing to cancel (unknown or idle agent), so the caller
   * can tell a refusal from a cancellation. `aborted` is flagged so a
   * half-finished sub-agent reply is not relayed back to Prime.
   */
  abort(sessionId: string, agentId: string): boolean {
    const agent = this.sessions.get(sessionId)?.agents.get(agentId);
    if (!agent || !agent.busy) return false;

    agent.aborted = true;
    console.log(
      `[pi:${sessionId}:${agentId}] abort`,
      JSON.stringify({ role: agent.role }),
    );
    agent.child.stdin.write(
      `${JSON.stringify({ id: randomUUID(), type: "abort" })}\n`,
    );
    return true;
  }

  /**
   * Kills a sub-agent and records its terminal status. `completed` marks a
   * graceful, Prime-initiated finish; otherwise the sub-agent is "killed".
   */
  killAgent(sessionId: string, agentId: string, completed = false): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const agent = session.agents.get(agentId);
    if (!agent || agent.role === "prime") return;

    agent.status = completed ? "completed" : "killed";
    agent.intentionalKill = true;
    session.agents.delete(agentId);
    agent.child.kill();
    this.runs.settleOpenFor(sessionId, agentId, settledForKill(completed));
    this.handlers.onSubagentUpdate(sessionId, toSubagentInfo(agent));
    this.notifyStatus(sessionId);
  }

  /**
   * Returns an agent's current model/thinking selection (resolved from its
   * spawn config), or `undefined` if the agent/session is unknown. Used to seed
   * the UI for Prime, whose selection the sub-agent roster does not carry.
   */
  getAgentSelection(
    sessionId: string,
    agentId: string,
  ): AgentModelSelection | undefined {
    const agent = this.sessions.get(sessionId)?.agents.get(agentId);
    if (!agent) return undefined;
    return {
      model: agent.config.model,
      thinkingDepth: agent.config.thinkingDepth,
    };
  }

  /** True when the given agent is live in the session's process roster. */
  hasAgent(sessionId: string, agentId: string): boolean {
    return Boolean(this.sessions.get(sessionId)?.agents.has(agentId));
  }

  /** Returns the session's sub-agent roster (Prime excluded). */
  listSubagents(sessionId: string): SubagentInfo[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return [...session.agents.values()]
      .filter((agent) => agent.role === "subagent")
      .map(toSubagentInfo);
  }

  /** Kills every agent in the session and clears its state. */
  dispose(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    for (const agent of session.agents.values()) {
      agent.intentionalKill = true;
      agent.child.kill();
    }
    this.notifyStatus(sessionId);
  }

  /** Kills every managed process. Used on server shutdown. */
  disposeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.dispose(sessionId);
    }
  }

  /**
   * The standing-context preambles appended to every agent's system prompt: the
   * current user, the session + global memory, and the host resources the
   * embedding app attached. Empty entries are dropped downstream.
   */
  private spawnPreambles(sessionId: string, session: SessionAgents): string[] {
    return [
      buildUserPreamble(session.user),
      this.memory.buildPreamble(session.rootPath),
      this.hostResources?.get(sessionId) ?? "",
    ];
  }

  private spawnAgent(
    sessionId: string,
    session: SessionAgents,
    descriptor: AgentDescriptor & {
      template?: string;
      autoRelayToPrime?: boolean;
    },
    config: AgentConfig,
    supervision?: { restartCount: number; lastRestartAt: number | null },
  ): AgentProcess {
    const extras = spawnExtras(session.config);
    logSpawn(sessionId, descriptor, session.rootPath, config, extras);

    const child = this.spawnProcess(
      PI_BIN,
      buildPiArgs(config, extras, this.spawnPreambles(sessionId, session)),
      {
        cwd: session.rootPath,
        env: spawnEnv(sessionId, descriptor),
        stdio: ["pipe", "pipe", "pipe"],
      },
    ) as ChildProcessWithoutNullStreams;

    const agent: AgentProcess = {
      agentId: descriptor.agentId,
      role: descriptor.role,
      name: descriptor.name,
      template: descriptor.template,
      homeConversationId: descriptor.homeConversationId,
      status: "active",
      createdAt: new Date().toISOString(),
      config,
      child,
      busy: false,
      aborted: false,
      currentMessageId: null,
      startEmitted: false,
      accum: "",
      thinkingAccum: "",
      lastFinalContent: "",
      autoRelayToPrime: descriptor.autoRelayToPrime ?? true,
      lastActivity: null,
      intentionalKill: false,
      restartCount: supervision?.restartCount ?? 0,
      lastRestartAt: supervision?.lastRestartAt ?? null,
    };
    session.agents.set(descriptor.agentId, agent);

    this.wireChildStreams(sessionId, agent);
    this.notifyStatus(sessionId);
    return agent;
  }

  /** Attaches stdout/stderr readers and lifecycle handlers to a Pi process. */
  private wireChildStreams(sessionId: string, agent: AgentProcess): void {
    const { child } = agent;

    attachJsonlReader(child.stdout, (line) =>
      this.handleStdoutLine(sessionId, agent, line),
    );

    child.stderr.on("data", (chunk: Buffer) => {
      console.error(
        `[pi:${sessionId}:${agent.agentId}] ${chunk.toString().trimEnd()}`,
      );
    });

    child.on("error", (err) => {
      console.error(`[pi:${sessionId}:${agent.agentId}] failed to spawn:`, err);
      this.failInFlight(sessionId, agent, err.message);
      this.handleChildExit(sessionId, agent);
    });

    child.on("exit", (code, signal) => {
      console.log(
        `[pi:${sessionId}:${agent.agentId}] process exited (code=${code}, signal=${signal})`,
      );
      this.failInFlight(sessionId, agent, "Pi process exited unexpectedly.");
      this.handleChildExit(sessionId, agent);
    });
  }

  /**
   * Decides what to do when a Pi child exits or fails to spawn. An expected exit
   * (deliberate kill, model change, dispose — or a slot already replaced by a
   * newer process) is dropped. A crash is auto-respawned with backoff until the
   * bounded retry budget is exhausted, after which the slot is marked terminal.
   */
  private handleChildExit(sessionId: string, agent: AgentProcess): void {
    const session = this.sessions.get(sessionId);
    // Ignore the exit if the session is gone or this process was already
    // replaced in the roster (e.g. a model-change respawn).
    if (!session || session.agents.get(agent.agentId) !== agent) return;

    if (agent.intentionalKill) {
      this.removeAgent(sessionId, agent, "killed");
      return;
    }

    const attempt = this.nextRestartAttempt(agent);
    if (attempt === null) {
      console.error(
        `[pi:${sessionId}:${agent.agentId}] supervisor gave up after ${MAX_RESTARTS} restarts`,
      );
      this.removeAgent(sessionId, agent, "error");
      return;
    }

    this.scheduleRespawn(sessionId, session, agent, attempt);
  }

  /**
   * Returns the next restart attempt number for a crashed process, or `null`
   * when the bounded retry budget is exhausted. Prior attempts older than
   * {@link RESTART_WINDOW_MS} are forgiven (the process ran healthily for a
   * while), so only a tight crash loop trips the limit.
   */
  private nextRestartAttempt(agent: AgentProcess): number | null {
    const now = Date.now();
    const withinWindow =
      agent.lastRestartAt !== null &&
      now - agent.lastRestartAt <= RESTART_WINDOW_MS;
    const priorAttempts = withinWindow ? agent.restartCount : 0;
    if (priorAttempts >= MAX_RESTARTS) return null;
    return priorAttempts + 1;
  }

  /**
   * Removes the dead process from the roster and schedules a fresh spawn of the
   * same agent (same id, name, template, config, auto-relay) after a backoff,
   * carrying the attempt count forward so the budget keeps shrinking. The
   * original in-flight task is not re-delivered.
   */
  private scheduleRespawn(
    sessionId: string,
    session: SessionAgents,
    agent: AgentProcess,
    attempt: number,
  ): void {
    const delay =
      RESTART_BACKOFF_MS[Math.min(attempt - 1, RESTART_BACKOFF_MS.length - 1)];
    console.warn(
      `[pi:${sessionId}:${agent.agentId}] supervisor respawn ${attempt}/${MAX_RESTARTS} in ${delay}ms`,
    );

    // Drop the dead process from the slot (no terminal status — we're reviving)
    // so status reflects the gap and a reconnect won't see a stale process.
    session.agents.delete(agent.agentId);
    this.notifyStatus(sessionId);

    const descriptor = {
      agentId: agent.agentId,
      role: agent.role,
      name: agent.name,
      template: agent.template,
      homeConversationId: agent.homeConversationId,
      autoRelayToPrime: agent.autoRelayToPrime,
    };
    const { config } = agent;

    setTimeout(() => {
      const live = this.sessions.get(sessionId);
      // Session disposed or the slot was already revived (e.g. a chat join) in
      // the meantime: nothing to do.
      if (!live || live.agents.has(agent.agentId)) return;
      const respawned = this.spawnAgent(sessionId, live, descriptor, config, {
        restartCount: attempt,
        lastRestartAt: Date.now(),
      });
      if (respawned.role === "subagent") {
        this.handlers.onSubagentUpdate(sessionId, toSubagentInfo(respawned));
      }
    }, delay).unref?.();
  }

  /**
   * Per-event-type handlers, keyed by the Pi RPC `type`. Unmapped types
   * (turn_* / response / extension_ui_request etc.) carry no chat-visible
   * signal and are ignored. Defined as a field so dispatch stays a single
   * table lookup.
   */
  private readonly eventHandlers: Record<string, (ctx: EventContext) => void> =
    {
      agent_start: ({ sessionId, agent }) =>
        this.onAgentStart(sessionId, agent),
      message_start: ({ agent, event }) => this.onMessageStart(agent, event),
      message_update: ({ sessionId, agent, descriptor, event }) =>
        this.onMessageDelta(
          sessionId,
          agent,
          descriptor,
          event.assistantMessageEvent,
        ),
      message_end: ({ sessionId, agent, descriptor, event }) =>
        this.onMessageEnd(sessionId, agent, descriptor, event),
      tool_execution_start: ({ sessionId, agent, event }) =>
        this.onToolExecutionStart(sessionId, agent, event),
      queue_update: ({ sessionId, descriptor, event }) =>
        this.onQueueUpdate(sessionId, descriptor, event),
      agent_end: ({ sessionId, agent }) => this.onAgentEnd(sessionId, agent),
    };

  /** Dispatches one parsed stdout line to the matching per-event handler. */
  private handleStdoutLine(
    sessionId: string,
    agent: AgentProcess,
    line: string,
  ): void {
    const event = parsePiEvent(line);
    logStdoutLine(sessionId, agent.agentId, line, event);
    if (!event) {
      console.error(`[pi:${sessionId}:${agent.agentId}] unparseable: ${line}`);
      return;
    }

    const handler = this.eventHandlers[event.type ?? ""];
    handler?.({ sessionId, agent, descriptor: toDescriptor(agent), event });
  }

  /** Begins a run: marks the agent busy and shows the "thinking" indicator. */
  private onAgentStart(sessionId: string, agent: AgentProcess): void {
    // A turn we did not initiate (Pi starting work off its own queue) still gets
    // a Run, so no stream is unattributable.
    if (!this.runs.current(sessionId, agent.agentId)) {
      this.runs.open({
        sessionId,
        participantId: agent.agentId,
        homeConversationId: agent.homeConversationId,
        ingress: "reaction",
      });
    }
    agent.busy = true;
    agent.aborted = false;
    agent.currentMessageId = null;
    agent.startEmitted = false;
    agent.accum = "";
    agent.thinkingAccum = "";
    agent.lastFinalContent = "";
    this.notifyStatus(sessionId);
    this.emitActivity(sessionId, agent, {
      kind: "thinking",
      label: "Thinking...",
    });
  }

  /**
   * Opens a fresh in-flight assistant message. The `start` event is deferred
   * to the first delta so a tool-only assistant message never opens an empty
   * bubble. Non-assistant messages (user / tool results) are ignored.
   */
  private onMessageStart(agent: AgentProcess, event: PiStdoutEvent): void {
    if (!isAssistantRole(event.message)) return;
    agent.currentMessageId = randomUUID();
    agent.startEmitted = false;
    agent.accum = "";
    agent.thinkingAccum = "";
  }

  /**
   * Accumulates and relays a streaming text/thinking delta. The first delta
   * lazily emits `start` (opening the bubble) and clears the activity
   * indicator, since the streaming bubble itself is now the visual.
   */
  private onMessageDelta(
    sessionId: string,
    agent: AgentProcess,
    descriptor: AgentDescriptor,
    raw: AssistantDelta | undefined,
  ): void {
    const delta = readDelta(raw);
    if (!delta || !agent.currentMessageId) return;

    if (!agent.startEmitted) {
      agent.startEmitted = true;
      this.emit(sessionId, descriptor, {
        type: "start",
        messageId: agent.currentMessageId,
      });
      this.emitActivity(sessionId, agent, null);
    }

    if (delta.kind === "delta") {
      agent.accum += delta.text;
    } else {
      agent.thinkingAccum += delta.text;
    }

    this.emit(sessionId, descriptor, {
      type: delta.kind,
      messageId: agent.currentMessageId,
      delta: delta.text,
    });
  }

  /**
   * Finalizes the in-flight assistant message into its own bubble. Empty
   * (tool-only) messages that never emitted `start` finalize silently. Between
   * messages the "working" indicator returns until the next message or the run
   * ends.
   */
  private onMessageEnd(
    sessionId: string,
    agent: AgentProcess,
    descriptor: AgentDescriptor,
    event: PiStdoutEvent,
  ): void {
    if (!isAssistantRole(event.message)) return;

    if (agent.currentMessageId && agent.startEmitted) {
      this.finalizeMessage(sessionId, agent, descriptor, event);
    }

    agent.currentMessageId = null;
    agent.startEmitted = false;
    agent.accum = "";
    agent.thinkingAccum = "";

    // Between messages the agent is processing/deciding; the next tool call or
    // delta replaces this. (Tool labels themselves persist past their end so
    // the user can read what just ran.)
    this.emitActivity(sessionId, agent, {
      kind: "thinking",
      label: "Thinking...",
    });
  }

  /**
   * Emits the `end` event for the in-flight message and records its text. The
   * event is what gets persisted as a Message and fanned out, so who wakes on it
   * is decided there — this only reports that the turn produced something, and
   * whether it was cut short.
   */
  private finalizeMessage(
    sessionId: string,
    agent: AgentProcess,
    descriptor: AgentDescriptor,
    event: PiStdoutEvent,
  ): void {
    const content =
      assistantTextFromMessage(event.message) || agent.accum || "";
    if (content.trim()) agent.lastFinalContent = content;

    this.emit(sessionId, descriptor, {
      type: "end",
      messageId: agent.currentMessageId as string,
      content,
      thinking: agent.thinkingAccum,
      ...(agent.aborted ? { aborted: true } : {}),
    });
  }

  /**
   * Surfaces a starting tool call as the ephemeral activity indicator. The
   * descriptive label deliberately persists past the tool's `tool_execution_end`
   * (which we ignore) until the next message streams in or another tool starts,
   * so fast tools stay readable instead of flashing past.
   */
  private onToolExecutionStart(
    sessionId: string,
    agent: AgentProcess,
    event: PiStdoutEvent,
  ): void {
    const toolName = event.toolName ?? "tool";
    this.emitActivity(sessionId, agent, {
      kind: "tool",
      label: toolActivityLabel(toolName, event.args),
      toolName,
    });
  }

  /**
   * Relays Pi's pending steer/follow-up queue to the chat layer so the UI can
   * surface queued nudges and clear them once the agent picks them up. Pi emits
   * this whenever the queue changes (message queued or drained).
   */
  private onQueueUpdate(
    sessionId: string,
    descriptor: AgentDescriptor,
    event: PiStdoutEvent,
  ): void {
    this.emit(sessionId, descriptor, {
      type: "queue",
      steering: toStringArray(event.steering),
      followUp: toStringArray(event.followUp),
    });
  }

  /** Ends a run: clears busy + the activity indicator. */
  private onAgentEnd(sessionId: string, agent: AgentProcess): void {
    console.log(
      `[pi:${sessionId}:${agent.agentId}] agent_end`,
      JSON.stringify({
        role: agent.role,
        lastContentLength: agent.lastFinalContent.length,
        aborted: agent.aborted,
      }),
    );

    const cancelled = agent.aborted;
    agent.currentMessageId = null;
    agent.startEmitted = false;
    agent.accum = "";
    agent.thinkingAccum = "";
    agent.lastFinalContent = "";
    agent.busy = false;
    agent.aborted = false;

    this.notifyStatus(sessionId);
    // Emitted before the Run settles, so the run's last event still carries its
    // id. An aborted run was cut short: that is a cancellation, not a finish.
    this.emitActivity(sessionId, agent, null);
    this.runs.settleOpenFor(
      sessionId,
      agent.agentId,
      cancelled ? "cancelled" : "completed",
    );
  }

  /**
   * Emits a run-level activity change and records it on the agent so a client
   * joining mid-run can replay it (see {@link listActivities}). The value is
   * never persisted to disk; it lives only on the in-memory process.
   */
  private emitActivity(
    sessionId: string,
    agent: AgentProcess,
    activity: AgentActivity | null,
  ): void {
    agent.lastActivity = activity;
    this.emit(sessionId, toDescriptor(agent), { type: "activity", activity });
  }

  /**
   * Returns the current run-level activity for each of a session's live agents
   * (Prime + sub-agents) that has one, so a joining client can replay it. Agents
   * that are idle (or have streamed past their activity) are omitted.
   */
  listActivities(
    sessionId: string,
  ): { conversationId: string; activity: AgentActivity }[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    const entries: { conversationId: string; activity: AgentActivity }[] = [];
    for (const agent of session.agents.values()) {
      if (agent.lastActivity) {
        entries.push({
          conversationId: agent.homeConversationId,
          activity: agent.lastActivity,
        });
      }
    }
    return entries;
  }

  /** Emits an error (and resets state) for an in-flight assistant message. */
  private failInFlight(
    sessionId: string,
    agent: AgentProcess,
    message: string,
  ): void {
    if (!agent.busy && !agent.currentMessageId) return;
    const messageId = agent.currentMessageId ?? undefined;
    agent.currentMessageId = null;
    agent.startEmitted = false;
    agent.accum = "";
    agent.thinkingAccum = "";
    agent.lastFinalContent = "";
    agent.busy = false;
    agent.aborted = false;
    const descriptor = {
      agentId: agent.agentId,
      role: agent.role,
      name: agent.name,
      homeConversationId: agent.homeConversationId,
    };
    this.emit(sessionId, descriptor, { type: "error", messageId, message });
    this.notifyStatus(sessionId);
    this.emitActivity(sessionId, agent, null);
    this.runs.settleOpenFor(sessionId, agent.agentId, "failed");
  }

  /**
   * Drops a crashed/exited agent from its session. If a sub-agent was still
   * marked active (i.e. it wasn't intentionally killed), it transitions to
   * `terminalStatus` and the roster is updated.
   */
  private removeAgent(
    sessionId: string,
    agent: AgentProcess,
    terminalStatus: SubagentStatus,
  ): void {
    const session = this.sessions.get(sessionId);
    const current = session?.agents.get(agent.agentId);
    if (!session || current !== agent) return;
    session.agents.delete(agent.agentId);

    if (agent.role === "subagent" && agent.status === "active") {
      agent.status = terminalStatus;
      this.handlers.onSubagentUpdate(sessionId, toSubagentInfo(agent));
    }
    this.notifyStatus(sessionId);
  }
}
