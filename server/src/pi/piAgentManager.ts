import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

import { PI_BIN } from "../config.ts";
import { type AgentConfig, getDefaultAgentConfig } from "./agentConfig.ts";

/**
 * Event surfaced to the chat layer as Pi streams a reply. `messageId`
 * correlates the `start`/`delta`/`end` of a single assistant message so the
 * client can build it up incrementally.
 */
export type AgentEvent =
  | { type: "start"; messageId: string }
  | { type: "delta"; messageId: string; delta: string }
  | { type: "thinking"; messageId: string; delta: string }
  | { type: "end"; messageId: string; content: string; thinking: string }
  | { type: "error"; messageId?: string; message: string };

export type AgentEventHandler = (
  sessionId: string,
  event: AgentEvent,
) => void;

interface AgentProcess {
  child: ChildProcessWithoutNullStreams;
  busy: boolean;
  /** The id of the assistant message currently streaming, if any. */
  currentMessageId: string | null;
  /** Accumulated text for the in-flight assistant message. */
  accum: string;
  /** Accumulated reasoning for the in-flight assistant message. */
  thinkingAccum: string;
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

/**
 * Manages one long-lived `pi --mode rpc` child process per session.
 *
 * Each session's process runs inside the session's scoped root folder. User
 * messages are written to stdin; Pi's streaming events are parsed from stdout
 * and relayed to the caller via the `onAgentEvent` handler, which the chat
 * layer forwards to the session's Socket.IO room.
 */
export class PiAgentManager {
  private readonly agents = new Map<string, AgentProcess>();
  private readonly onAgentEvent: AgentEventHandler;

  constructor(onAgentEvent: AgentEventHandler) {
    this.onAgentEvent = onAgentEvent;
  }

  /**
   * Spawns the session's Pi process if it isn't already running.
   *
   * `config` selects the tool allowlist and appended system prompt for the
   * session. In Phase 3 every session uses {@link getDefaultAgentConfig}; the
   * parameter is the seam for per-session configs later.
   */
  ensure(sessionId: string, rootPath: string, config?: AgentConfig): void {
    if (this.agents.has(sessionId)) return;

    if (!process.env.PI_PROXY_API_KEY) {
      console.warn(
        "[pi] PI_PROXY_API_KEY is not set; Pi will fail to reach the LLM gateway. " +
          "Run `export PI_PROXY_API_KEY=$(devx llm-gateway print-token --key)` before starting the server.",
      );
    }

    const { tools, appendSystemPrompt } = config ?? getDefaultAgentConfig();

    const child = spawn(
      PI_BIN,
      [
        "--mode",
        "rpc",
        "--no-session",
        "--tools",
        tools.join(","),
        "--append-system-prompt",
        appendSystemPrompt,
      ],
      { cwd: rootPath, env: process.env, stdio: ["pipe", "pipe", "pipe"] },
    ) as ChildProcessWithoutNullStreams;

    const agent: AgentProcess = {
      child,
      busy: false,
      currentMessageId: null,
      accum: "",
      thinkingAccum: "",
    };
    this.agents.set(sessionId, agent);

    attachJsonlReader(child.stdout, (line) =>
      this.handleStdoutLine(sessionId, agent, line),
    );

    child.stderr.on("data", (chunk: Buffer) => {
      console.error(`[pi:${sessionId}] ${chunk.toString().trimEnd()}`);
    });

    child.on("error", (err) => {
      console.error(`[pi:${sessionId}] failed to spawn:`, err);
      this.failInFlight(sessionId, agent, err.message);
      this.agents.delete(sessionId);
    });

    child.on("exit", (code, signal) => {
      console.log(
        `[pi:${sessionId}] process exited (code=${code}, signal=${signal})`,
      );
      this.failInFlight(sessionId, agent, "Pi process exited unexpectedly.");
      this.agents.delete(sessionId);
    });
  }

  /**
   * Relays a user message to the session's Pi process. If the agent is already
   * streaming, the message is queued with `followUp` so nothing is dropped.
   */
  prompt(
    sessionId: string,
    rootPath: string,
    text: string,
    config?: AgentConfig,
  ): void {
    this.ensure(sessionId, rootPath, config);
    const agent = this.agents.get(sessionId);
    if (!agent) {
      this.onAgentEvent(sessionId, {
        type: "error",
        message: "Pi process is not available.",
      });
      return;
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

  /** Kills the session's Pi process and clears its state. */
  dispose(sessionId: string): void {
    const agent = this.agents.get(sessionId);
    if (!agent) return;
    this.agents.delete(sessionId);
    agent.child.kill();
  }

  /** Kills every managed Pi process. Used on server shutdown. */
  disposeAll(): void {
    for (const sessionId of [...this.agents.keys()]) {
      this.dispose(sessionId);
    }
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
      console.error(`[pi:${sessionId}] unparseable line: ${line}`);
      return;
    }

    switch (event.type) {
      case "agent_start": {
        const messageId = randomUUID();
        agent.currentMessageId = messageId;
        agent.accum = "";
        agent.thinkingAccum = "";
        this.onAgentEvent(sessionId, { type: "start", messageId });
        return;
      }

      case "message_update": {
        const delta = event.assistantMessageEvent as
          | { type?: string; delta?: string }
          | undefined;
        if (delta?.type === "text_delta" && typeof delta.delta === "string") {
          if (!agent.currentMessageId) return;
          agent.accum += delta.delta;
          this.onAgentEvent(sessionId, {
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
          this.onAgentEvent(sessionId, {
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
        this.onAgentEvent(sessionId, {
          type: "end",
          messageId,
          content,
          thinking,
        });
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
    this.onAgentEvent(sessionId, { type: "error", messageId, message });
  }
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
