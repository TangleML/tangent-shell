import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  type AgentActivity,
  type ChatAuthor,
  PI_AGENT,
  type SubagentInfo,
  type SubagentStatus,
} from "@shared/contracts.ts";

import {
  INTERNAL_TOKEN,
  INTERNAL_URL,
  PI_BIN,
  PI_DEBUG,
  PI_MODEL,
  PI_PROVIDER,
  PI_PROXY_URL,
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
  toDescriptor,
  toolActivityLabel,
  toSubagentInfo,
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

/** Builds the `pi --mode rpc` CLI args for an agent process. */
function buildPiArgs(
  config: AgentConfig,
  extras: SpawnExtras,
  memoryPreamble: string,
): string[] {
  const args = [
    "--mode",
    "rpc",
    "--no-session",
    "--provider",
    PI_PROVIDER,
    "--model",
    PI_MODEL,
    "--tools",
    config.tools.join(","),
    "--append-system-prompt",
    appendWithMemory(config, memoryPreamble),
    // Orchestrator gives Prime its sub-agent tools; the proxy-provider
    // extension registers Pi's providers against the LLM proxy (required in
    // environments without an auto-discovered `~/.pi/agent` config); the memory
    // extension registers the read/remember tools.
    "--extension",
    ORCHESTRATOR_EXTENSION,
    "--extension",
    PROXY_PROVIDER_EXTENSION,
    "--extension",
    MEMORY_EXTENSION,
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
  console.log(
    `[pi:${sessionId}:${descriptor.agentId}] spawning`,
    JSON.stringify({
      bin: PI_BIN,
      role: descriptor.role,
      cwd,
      provider: PI_PROVIDER,
      model: PI_MODEL,
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

  constructor(handlers: PiAgentHandlers, memory: MemoryManager) {
    this.handlers = handlers;
    this.memory = memory;
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

    this.spawnAgent(
      sessionId,
      session,
      { agentId: PRIME_AGENT_ID, role: "prime", name: "Prime" },
      session.config?.prime ?? getPrimeAgentConfig(),
    );
  }

  /**
   * Relays a human message to the session's Prime process, spawning it first if
   * needed. Only Prime receives human input; sub-agents are directed by Prime.
   */
  prompt(sessionId: string, rootPath: string, text: string): void {
    this.ensure(sessionId, rootPath);
    this.sendToAgent(sessionId, PRIME_AGENT_ID, text);
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
   * streaming, the message is queued with `followUp` so nothing is dropped.
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

    if (surfaceAuthor && agent.role === "subagent") {
      this.handlers.onAgentMessage(sessionId, agentId, surfaceAuthor, text);
    }

    const command: Record<string, unknown> = {
      id: randomUUID(),
      type: "prompt",
      message: text,
    };
    if (agent.busy) command.streamingBehavior = "followUp";

    console.log(
      `[pi:${sessionId}:${agentId}] prompt`,
      JSON.stringify({
        role: agent.role,
        wasBusy: agent.busy,
        textLength: text.length,
      }),
    );

    agent.busy = true;
    agent.child.stdin.write(`${JSON.stringify(command)}\n`);
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
      child,
      busy: false,
      currentMessageId: null,
      startEmitted: false,
      accum: "",
      thinkingAccum: "",
      lastFinalContent: "",
    };
    session.agents.set(descriptor.agentId, agent);

    this.wireChildStreams(sessionId, agent);
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
    agent.currentMessageId = null;
    agent.startEmitted = false;
    agent.accum = "";
    agent.thinkingAccum = "";
    agent.lastFinalContent = "";
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
    const content = assistantTextFromMessage(event.message) || agent.accum || "";
    if (content.trim()) agent.lastFinalContent = content;

    this.handlers.onAgentEvent(sessionId, descriptor, {
      type: "end",
      messageId: agent.currentMessageId as string,
      content,
      thinking: agent.thinkingAccum,
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

  /** Ends a run: clears busy + the activity indicator and loops Prime in. */
  private onAgentEnd(
    sessionId: string,
    agent: AgentProcess,
    descriptor: AgentDescriptor,
  ): void {
    const lastContent = agent.lastFinalContent;

    console.log(
      `[pi:${sessionId}:${agent.agentId}] agent_end`,
      JSON.stringify({
        role: agent.role,
        lastContentLength: lastContent.length,
      }),
    );

    agent.currentMessageId = null;
    agent.startEmitted = false;
    agent.accum = "";
    agent.thinkingAccum = "";
    agent.lastFinalContent = "";
    agent.busy = false;

    this.emitActivity(sessionId, descriptor, null);
    this.relaySubagentReply(sessionId, agent, lastContent);
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
   * Keeps Prime in the loop: a sub-agent's reply is fed back so Prime can
   * react. (Sub-agents are directed only by Prime; this closes the loop.)
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
  }
}
