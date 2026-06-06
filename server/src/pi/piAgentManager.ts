import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

import {
  type AgentRole,
  type ChatAuthor,
  PI_AGENT,
  type SubagentInfo,
  type SubagentStatus,
} from "@shared/contracts.ts";

import { INTERNAL_TOKEN, INTERNAL_URL, PI_BIN } from "../config.ts";
import {
  type AgentConfig,
  getPrimeAgentConfig,
  resolveSubagentConfig,
  type SubagentSpawnRequest,
} from "./agentConfig.ts";

/** Fixed id of the session's Prime agent (one per session). */
export const PRIME_AGENT_ID = "prime";

/**
 * Event surfaced to the chat layer as an agent streams a reply. `messageId`
 * correlates the `start`/`delta`/`end` of a single assistant message so the
 * client can build it up incrementally.
 */
export type AgentEvent =
  | { type: "start"; messageId: string }
  | { type: "delta"; messageId: string; delta: string }
  | { type: "thinking"; messageId: string; delta: string }
  | { type: "end"; messageId: string; content: string; thinking: string }
  | { type: "error"; messageId?: string; message: string };

/** Identifies which agent in a session produced an {@link AgentEvent}. */
export interface AgentDescriptor {
  agentId: string;
  role: AgentRole;
  name: string;
}

export type AgentEventHandler = (
  sessionId: string,
  agent: AgentDescriptor,
  event: AgentEvent,
) => void;

export type SubagentUpdateHandler = (
  sessionId: string,
  subagent: SubagentInfo,
) => void;

/**
 * Surfaces a directed message (e.g. a task Prime sends a sub-agent) into a
 * specific conversation's transcript. `conversationId` is the owning agent's
 * id; `author` is the sender to attribute it to.
 */
export type AgentMessageHandler = (
  sessionId: string,
  conversationId: string,
  author: ChatAuthor,
  content: string,
) => void;

export interface PiAgentHandlers {
  /** Relays an agent's streaming events to the session's room. */
  onAgentEvent: AgentEventHandler;
  /** Relays a sub-agent's spawn or status change to the session's room. */
  onSubagentUpdate: SubagentUpdateHandler;
  /** Surfaces a directed message into a sub-agent's transcript. */
  onAgentMessage: AgentMessageHandler;
}

interface AgentProcess {
  agentId: string;
  role: AgentRole;
  name: string;
  template?: string;
  status: SubagentStatus;
  createdAt: string;
  child: ChildProcessWithoutNullStreams;
  busy: boolean;
  /** The id of the assistant message currently streaming, if any. */
  currentMessageId: string | null;
  /** Accumulated text for the in-flight assistant message. */
  accum: string;
  /** Accumulated reasoning for the in-flight assistant message. */
  thinkingAccum: string;
}

interface SessionAgents {
  rootPath: string;
  agents: Map<string, AgentProcess>;
}

/**
 * Reads a stream as strict JSONL: records are delimited by LF only, with an
 * optional trailing CR stripped. Node's `readline` is intentionally avoided
 * because it also splits on U+2028/U+2029, which are valid inside JSON strings.
 */
function attachJsonlReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): void {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  stream.on("data", (chunk: Buffer | string) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;

      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length > 0) onLine(line);
    }
  });

  stream.on("end", () => {
    buffer += decoder.end();
    if (buffer.length > 0) {
      onLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
    }
  });
}

/** Absolute path to the orchestrator extension loaded into every Pi process. */
const ORCHESTRATOR_EXTENSION = path.join(
  import.meta.dirname,
  "extensions",
  "orchestrator.ts",
);

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

  constructor(handlers: PiAgentHandlers) {
    this.handlers = handlers;
  }

  /** Spawns the session's Prime process if it isn't already running. */
  ensure(sessionId: string, rootPath: string): void {
    let session = this.sessions.get(sessionId);
    if (session?.agents.has(PRIME_AGENT_ID)) return;

    if (!process.env.PI_PROXY_API_KEY) {
      console.warn(
        "[pi] PI_PROXY_API_KEY is not set; Pi will fail to reach the LLM gateway. " +
          "Run `export PI_PROXY_API_KEY=$(devx llm-gateway print-token --key)` before starting the server.",
      );
    }

    if (!session) {
      session = { rootPath, agents: new Map() };
      this.sessions.set(sessionId, session);
    }

    this.spawnAgent(
      sessionId,
      session,
      { agentId: PRIME_AGENT_ID, role: "prime", name: "Prime" },
      getPrimeAgentConfig(),
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
    const config = resolveSubagentConfig(request);

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

    agent.busy = true;
    agent.child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  /**
   * Kills a sub-agent and records its terminal status. `completed` marks a
   * graceful, Prime-initiated finish; otherwise the sub-agent is "killed".
   */
  killAgent(sessionId: string, agentId: string, completed = false): void {
    const session = this.sessions.get(sessionId);
    const agent = session?.agents.get(agentId);
    if (!session || !agent || agent.role === "prime") return;

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
    const child = spawn(
      PI_BIN,
      [
        "--mode",
        "rpc",
        "--no-session",
        "--tools",
        config.tools.join(","),
        "--append-system-prompt",
        config.appendSystemPrompt,
        "--extension",
        ORCHESTRATOR_EXTENSION,
      ],
      {
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
      },
    ) as ChildProcessWithoutNullStreams;

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
      accum: "",
      thinkingAccum: "",
    };
    session.agents.set(descriptor.agentId, agent);

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

    return agent;
  }

  private handleStdoutLine(
    sessionId: string,
    agent: AgentProcess,
    line: string,
  ): void {
    let event: { type?: string; [key: string]: unknown };
    try {
      event = JSON.parse(line);
    } catch {
      console.error(`[pi:${sessionId}:${agent.agentId}] unparseable: ${line}`);
      return;
    }

    const descriptor: AgentDescriptor = {
      agentId: agent.agentId,
      role: agent.role,
      name: agent.name,
    };

    switch (event.type) {
      case "agent_start": {
        const messageId = randomUUID();
        agent.currentMessageId = messageId;
        agent.accum = "";
        agent.thinkingAccum = "";
        this.handlers.onAgentEvent(sessionId, descriptor, {
          type: "start",
          messageId,
        });
        return;
      }

      case "message_update": {
        const delta = event.assistantMessageEvent as
          | { type?: string; delta?: string }
          | undefined;
        if (delta?.type === "text_delta" && typeof delta.delta === "string") {
          if (!agent.currentMessageId) return;
          agent.accum += delta.delta;
          this.handlers.onAgentEvent(sessionId, descriptor, {
            type: "delta",
            messageId: agent.currentMessageId,
            delta: delta.delta,
          });
        } else if (
          delta?.type === "thinking_delta" &&
          typeof delta.delta === "string"
        ) {
          if (!agent.currentMessageId) return;
          agent.thinkingAccum += delta.delta;
          this.handlers.onAgentEvent(sessionId, descriptor, {
            type: "thinking",
            messageId: agent.currentMessageId,
            delta: delta.delta,
          });
        }
        return;
      }

      case "agent_end": {
        if (!agent.currentMessageId) {
          agent.busy = false;
          return;
        }
        const content =
          agent.accum ||
          extractLastAssistantText(event as { messages?: unknown }) ||
          "";
        const messageId = agent.currentMessageId;
        const thinking = agent.thinkingAccum;
        agent.currentMessageId = null;
        agent.accum = "";
        agent.thinkingAccum = "";
        agent.busy = false;
        this.handlers.onAgentEvent(sessionId, descriptor, {
          type: "end",
          messageId,
          content,
          thinking,
        });

        // Keep Prime in the loop: a sub-agent's reply is fed back so Prime can
        // react. (Sub-agents are directed only by Prime; this closes the loop.)
        if (agent.role === "subagent" && content.trim()) {
          this.sendToAgent(
            sessionId,
            PRIME_AGENT_ID,
            `Sub-agent "${agent.name}" replied:\n\n${content}`,
          );
        }
        return;
      }

      default:
        // response / message_start / message_end / turn_* /
        // extension_ui_request etc. are not needed for chat-only relay.
        return;
    }
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
    agent.accum = "";
    agent.thinkingAccum = "";
    agent.busy = false;
    this.handlers.onAgentEvent(
      sessionId,
      { agentId: agent.agentId, role: agent.role, name: agent.name },
      { type: "error", messageId, message },
    );
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

function toSubagentInfo(agent: AgentProcess): SubagentInfo {
  return {
    id: agent.agentId,
    name: agent.name,
    status: agent.status,
    ...(agent.template ? { template: agent.template } : {}),
    createdAt: agent.createdAt,
  };
}

/** Pulls the last assistant message's text out of an `agent_end` event. */
function extractLastAssistantText(event: {
  messages?: unknown;
}): string | undefined {
  if (!Array.isArray(event.messages)) return undefined;
  for (let i = event.messages.length - 1; i >= 0; i--) {
    const message = event.messages[i] as {
      role?: string;
      content?: Array<{ type?: string; text?: string }>;
    };
    if (message?.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }
    const text = message.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
    if (text) return text;
  }
  return undefined;
}
