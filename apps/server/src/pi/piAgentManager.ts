import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  type AgentActivity,
  type ChatAuthor,
  type MessageDelivery,
  PI_AGENT,
  type SessionRunStatus,
  type SessionStatusPayload,
  type SubagentInfo,
  type SubagentStatus,
  type ThinkingLevel,
} from "@tangent/shared/contracts.ts";

import {
  INTERNAL_TOKEN,
  INTERNAL_URL,
  PI_BIN,
  PI_DEBUG,
  PI_MODEL,
  PI_PROVIDER,
  PI_PROXY_URL,
  PI_THINKING,
} from "../config.ts";
import {
  type AgentConfig,
  getPrimeAgentConfig,
  type ResolvedSessionConfig,
  resolveSubagentConfig,
  type SubagentSpawnRequest,
} from "./agentConfig.ts";
import type { MemoryManager } from "./memory.ts";
import {
  type AgentDescriptor,
  type AgentProcess,
  type AssistantDelta,
  type PiAgentHandlers,
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
  PiAgentHandlers,
  SubagentUpdateHandler,
} from "./types.ts";

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
 * Joins an agent's base appended system prompt with the per-session memory
 * preamble, so every agent starts each session aware of its current memory.
 */
function appendWithMemory(config: AgentConfig, memoryPreamble: string): string {
  if (!memoryPreamble.trim()) return config.appendSystemPrompt;
  return `${config.appendSystemPrompt}\n\n${memoryPreamble}`;
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
  memoryPreamble: string,
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
    appendWithMemory(config, memoryPreamble),
    // Orchestrator gives Prime its sub-agent tools; the proxy-provider
    // extension registers Pi's providers against the LLM proxy (required in
    // environments without an auto-discovered `~/.pi/agent` config); the memory
    // extension registers the read/remember tools; the triggers extension gives
    // Prime its create/list/enable/disable/delete trigger tools; the session
    // extension gives Prime its rename_session tool.
    "--extension",
    ORCHESTRATOR_EXTENSION,
    "--extension",
    PROXY_PROVIDER_EXTENSION,
    "--extension",
    MEMORY_EXTENSION,
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
  private readonly handlers: PiAgentHandlers;
  private readonly memory: MemoryManager;
  /**
   * Last run status emitted per session, so {@link notifyStatus} only fires the
   * handler when the status actually changes (busy flags toggle frequently).
   */
  private readonly lastStatus = new Map<string, SessionRunStatus>();

  constructor(handlers: PiAgentHandlers, memory: MemoryManager) {
    this.handlers = handlers;
    this.memory = memory;
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
   */
  ensure(
    sessionId: string,
    rootPath: string,
    config?: ResolvedSessionConfig,
    primeOverride?: AgentModelSelection,
  ): void {
    let session = this.sessions.get(sessionId);
    if (session?.agents.has(PRIME_AGENT_ID)) return;

    warnMissingProxyEnv();

    // Prepare memory before the first spawn so the preamble reflects any
    // bundle-seeded session memory and the current global store.
    this.memory.initSession(rootPath);

    if (!session) {
      session = { rootPath, agents: new Map(), config };
      this.sessions.set(sessionId, session);
    }

    const primeConfig = session.config?.prime ?? getPrimeAgentConfig();
    this.spawnAgent(
      sessionId,
      session,
      { agentId: PRIME_AGENT_ID, role: "prime", name: "Prime" },
      withModelSelection(primeConfig, primeOverride),
    );
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
    };
    const nextConfig = withModelSelection(existing.config, selection);

    // Quiet the outgoing process so its kill-triggered exit handler doesn't
    // emit a spurious in-flight error for the run we're intentionally cutting.
    existing.busy = false;
    existing.currentMessageId = null;
    existing.aborted = true;
    existing.child.kill();

    const agent = this.spawnAgent(sessionId, session, descriptor, nextConfig);
    const info = toSubagentInfo(agent);
    if (agent.role === "subagent") {
      this.handlers.onSubagentUpdate(sessionId, info);
    }
    return { role: agent.role, info };
  }

  /**
   * Relays a human message to the session's Prime process, spawning it first if
   * needed. Only Prime receives human input; sub-agents are directed by Prime.
   * `delivery` controls how the message is queued when Prime is mid-run.
   */
  prompt(
    sessionId: string,
    rootPath: string,
    text: string,
    delivery: MessageDelivery = "auto",
  ): void {
    this.ensure(sessionId, rootPath);
    this.sendToAgent(sessionId, PRIME_AGENT_ID, text, undefined, delivery);
  }

  /**
   * Spawns a sub-agent for the session and returns its roster entry. Optionally
   * delivers an initial task. The session's Prime must already exist.
   */
  spawnSubagent(
    sessionId: string,
    request: SubagentSpawnRequest,
  ): SubagentInfo {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`No active session for ${sessionId}`);
    }

    const agentId = randomUUID();
    const config = resolveSubagentConfig(request, {
      templates: session.config?.templates,
      defaults: session.config?.subagentDefaults,
    });

    const agent = this.spawnAgent(
      sessionId,
      session,
      {
        agentId,
        role: "subagent",
        name: request.name,
        template: request.template,
      },
      config,
    );

    const info = toSubagentInfo(agent);
    this.handlers.onSubagentUpdate(sessionId, info);

    if (request.task && request.task.trim()) {
      this.sendToAgent(sessionId, agentId, request.task, PI_AGENT);
    }

    return info;
  }

  /**
   * Delivers a message to a specific agent's stdin. If that agent is already
   * streaming, the message is queued: `delivery: "steer"` applies it after the
   * current tool call (before the next LLM call), while `"followUp"` (and the
   * `"auto"` default) waits until the run fully stops. The default preserves
   * the original behavior so internal relays never drop a message.
   *
   * When `surfaceAuthor` is provided and the target is a sub-agent, the message
   * is also surfaced into that sub-agent's transcript (attributed to
   * `surfaceAuthor`), so directed tasks read as a real conversation. Internal
   * relays (e.g. feeding a sub-agent's reply back to Prime) omit it.
   */
  sendToAgent(
    sessionId: string,
    agentId: string,
    text: string,
    surfaceAuthor?: ChatAuthor,
    delivery: MessageDelivery = "auto",
  ): void {
    const agent = this.sessions.get(sessionId)?.agents.get(agentId);
    if (!agent) {
      this.handlers.onAgentEvent(
        sessionId,
        { agentId, role: "prime", name: "Prime" },
        { type: "error", message: `Agent ${agentId} is not available.` },
      );
      return;
    }

    this.surfaceDirectedMessage(sessionId, agent, text, surfaceAuthor);

    const command: Record<string, unknown> = {
      id: randomUUID(),
      type: "prompt",
      message: text,
    };
    // `streamingBehavior` is only valid while the agent is streaming; when idle,
    // send a plain prompt.
    if (agent.busy) {
      command.streamingBehavior = busyStreamingBehavior(delivery);
    }

    console.log(
      `[pi:${sessionId}:${agentId}] prompt`,
      JSON.stringify({
        role: agent.role,
        wasBusy: agent.busy,
        delivery,
        textLength: text.length,
      }),
    );

    agent.busy = true;
    agent.child.stdin.write(`${JSON.stringify(command)}\n`);
    this.notifyStatus(sessionId);
  }

  /**
   * Surfaces a directed message into a sub-agent's transcript (attributed to
   * `surfaceAuthor`) so directed tasks and human nudges read as a real
   * conversation. No-op for Prime or when no author is given (internal relays).
   */
  private surfaceDirectedMessage(
    sessionId: string,
    agent: AgentProcess,
    text: string,
    surfaceAuthor?: ChatAuthor,
  ): void {
    if (!surfaceAuthor || agent.role !== "subagent") return;
    this.handlers.onAgentMessage(sessionId, agent.agentId, surfaceAuthor, text);
  }

  /**
   * Delivers a sub-agent's directed update to Prime (the `message_prime` tool).
   * The report is surfaced in the sub-agent's own transcript (attributed to the
   * sub-agent) so the user sees it in that thread, and delivered to Prime's
   * stdin so it can react immediately — Prime is event-driven and otherwise
   * only wakes on the end-of-run relay. Ignored for unknown or non-sub-agents.
   */
  reportToPrime(sessionId: string, fromAgentId: string, text: string): void {
    const agent = this.sessions.get(sessionId)?.agents.get(fromAgentId);
    if (!agent || agent.role !== "subagent") return;

    const author: ChatAuthor = {
      id: agent.agentId,
      kind: "agent",
      name: agent.name,
      agentRole: "subagent",
    };
    this.handlers.onAgentMessage(sessionId, fromAgentId, author, text);
    this.sendToAgent(
      sessionId,
      PRIME_AGENT_ID,
      `Sub-agent "${agent.name}" reported:\n\n${text}`,
    );
  }

  /**
   * Aborts an agent's in-progress run (Prime or a sub-agent) by sending Pi's
   * `abort` RPC command on stdin. The process stays alive and emits `agent_end`,
   * which resets its state through the normal event flow. No-op when the agent
   * is unknown or idle. `aborted` is flagged so a half-finished sub-agent reply
   * is not relayed back to Prime.
   */
  abort(sessionId: string, agentId: string): void {
    const agent = this.sessions.get(sessionId)?.agents.get(agentId);
    if (!agent || !agent.busy) return;

    agent.aborted = true;
    console.log(
      `[pi:${sessionId}:${agentId}] abort`,
      JSON.stringify({ role: agent.role }),
    );
    agent.child.stdin.write(
      `${JSON.stringify({ id: randomUUID(), type: "abort" })}\n`,
    );
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
    session.agents.delete(agentId);
    agent.child.kill();
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

  private spawnAgent(
    sessionId: string,
    session: SessionAgents,
    descriptor: AgentDescriptor & { template?: string },
    config: AgentConfig,
  ): AgentProcess {
    const extras = spawnExtras(session.config);
    logSpawn(sessionId, descriptor, session.rootPath, config, extras);

    const memoryPreamble = this.memory.buildPreamble(session.rootPath);
    const child = spawn(PI_BIN, buildPiArgs(config, extras, memoryPreamble), {
      cwd: session.rootPath,
      env: {
        ...process.env,
        TANGENT_SESSION_ID: sessionId,
        TANGENT_AGENT_ID: descriptor.agentId,
        TANGENT_AGENT_ROLE: descriptor.role,
        TANGENT_INTERNAL_URL: INTERNAL_URL,
        TANGENT_INTERNAL_TOKEN: INTERNAL_TOKEN,
      },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    const agent: AgentProcess = {
      agentId: descriptor.agentId,
      role: descriptor.role,
      name: descriptor.name,
      template: descriptor.template,
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
      this.removeAgent(sessionId, agent, "error");
    });

    child.on("exit", (code, signal) => {
      console.log(
        `[pi:${sessionId}:${agent.agentId}] process exited (code=${code}, signal=${signal})`,
      );
      this.failInFlight(sessionId, agent, "Pi process exited unexpectedly.");
      this.removeAgent(sessionId, agent, "error");
    });
  }

  /**
   * Per-event-type handlers, keyed by the Pi RPC `type`. Unmapped types
   * (turn_* / response / extension_ui_request etc.) carry no chat-visible
   * signal and are ignored. Defined as a field so dispatch stays a single
   * table lookup.
   */
  private readonly eventHandlers: Record<string, (ctx: EventContext) => void> =
    {
      agent_start: ({ sessionId, agent, descriptor }) =>
        this.onAgentStart(sessionId, agent, descriptor),
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
      tool_execution_start: ({ sessionId, descriptor, event }) =>
        this.onToolExecutionStart(sessionId, descriptor, event),
      queue_update: ({ sessionId, descriptor, event }) =>
        this.onQueueUpdate(sessionId, descriptor, event),
      agent_end: ({ sessionId, agent, descriptor }) =>
        this.onAgentEnd(sessionId, agent, descriptor),
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
  private onAgentStart(
    sessionId: string,
    agent: AgentProcess,
    descriptor: AgentDescriptor,
  ): void {
    agent.busy = true;
    agent.aborted = false;
    agent.currentMessageId = null;
    agent.startEmitted = false;
    agent.accum = "";
    agent.thinkingAccum = "";
    agent.lastFinalContent = "";
    this.notifyStatus(sessionId);
    this.emitActivity(sessionId, descriptor, {
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
      this.handlers.onAgentEvent(sessionId, descriptor, {
        type: "start",
        messageId: agent.currentMessageId,
      });
      this.emitActivity(sessionId, descriptor, null);
    }

    if (delta.kind === "delta") {
      agent.accum += delta.text;
    } else {
      agent.thinkingAccum += delta.text;
    }

    this.handlers.onAgentEvent(sessionId, descriptor, {
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
    this.emitActivity(sessionId, descriptor, {
      kind: "thinking",
      label: "Thinking...",
    });
  }

  /** Emits the `end` event for the in-flight message and records its text. */
  private finalizeMessage(
    sessionId: string,
    agent: AgentProcess,
    descriptor: AgentDescriptor,
    event: PiStdoutEvent,
  ): void {
    const content =
      assistantTextFromMessage(event.message) || agent.accum || "";
    if (content.trim()) agent.lastFinalContent = content;

    this.handlers.onAgentEvent(sessionId, descriptor, {
      type: "end",
      messageId: agent.currentMessageId as string,
      content,
      thinking: agent.thinkingAccum,
    });

    // Safety net: relay every finalized sub-agent message to Prime as it lands,
    // not just the last one at run end, so intermediate reports (e.g. submitted
    // run ids) reach Prime even when the sub-agent doesn't call message_prime.
    // A user-aborted run is intentionally cut short, so its partial output is
    // not relayed back to Prime as if the sub-agent finished its task.
    if (agent.aborted) return;
    this.relaySubagentReply(sessionId, agent, content);
  }

  /**
   * Surfaces a starting tool call as the ephemeral activity indicator. The
   * descriptive label deliberately persists past the tool's `tool_execution_end`
   * (which we ignore) until the next message streams in or another tool starts,
   * so fast tools stay readable instead of flashing past.
   */
  private onToolExecutionStart(
    sessionId: string,
    descriptor: AgentDescriptor,
    event: PiStdoutEvent,
  ): void {
    const toolName = event.toolName ?? "tool";
    this.emitActivity(sessionId, descriptor, {
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
    this.handlers.onAgentEvent(sessionId, descriptor, {
      type: "queue",
      steering: toStringArray(event.steering),
      followUp: toStringArray(event.followUp),
    });
  }

  /**
   * Ends a run: clears busy + the activity indicator. Sub-agent replies are no
   * longer relayed here — each finalized message is relayed to Prime as it
   * lands in {@link finalizeMessage}, so intermediate reports aren't dropped.
   */
  private onAgentEnd(
    sessionId: string,
    agent: AgentProcess,
    descriptor: AgentDescriptor,
  ): void {
    console.log(
      `[pi:${sessionId}:${agent.agentId}] agent_end`,
      JSON.stringify({
        role: agent.role,
        lastContentLength: agent.lastFinalContent.length,
        aborted: agent.aborted,
      }),
    );

    agent.currentMessageId = null;
    agent.startEmitted = false;
    agent.accum = "";
    agent.thinkingAccum = "";
    agent.lastFinalContent = "";
    agent.busy = false;
    agent.aborted = false;

    this.notifyStatus(sessionId);
    this.emitActivity(sessionId, descriptor, null);
  }

  /** Emits a run-level activity change (ephemeral; never persisted). */
  private emitActivity(
    sessionId: string,
    descriptor: AgentDescriptor,
    activity: AgentActivity | null,
  ): void {
    this.handlers.onAgentEvent(sessionId, descriptor, {
      type: "activity",
      activity,
    });
  }

  /**
   * Keeps Prime in the loop: each finalized sub-agent message is fed back so
   * Prime can react as it lands (sub-agents are directed only by Prime; this
   * closes the loop). Called per message rather than once at run end so
   * intermediate updates aren't dropped. No-op for Prime or empty content.
   */
  private relaySubagentReply(
    sessionId: string,
    agent: AgentProcess,
    content: string,
  ): void {
    if (agent.role !== "subagent" || !content.trim()) return;
    this.sendToAgent(
      sessionId,
      PRIME_AGENT_ID,
      `Sub-agent "${agent.name}" replied:\n\n${content}`,
    );
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
    };
    this.handlers.onAgentEvent(sessionId, descriptor, {
      type: "error",
      messageId,
      message,
    });
    this.notifyStatus(sessionId);
    this.emitActivity(sessionId, descriptor, null);
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
