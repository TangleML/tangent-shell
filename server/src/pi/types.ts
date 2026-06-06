import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type {
  AgentRole,
  ChatAuthor,
  SubagentInfo,
  SubagentStatus,
} from "@shared/contracts.ts";

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

export interface AgentProcess {
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

export interface SessionAgents {
  rootPath: string;
  agents: Map<string, AgentProcess>;
}

/** A single delta payload nested inside a `message_update` event. */
export interface AssistantDelta {
  type?: string;
  delta?: string;
}

/**
 * A parsed line from a Pi process's stdout (JSONL RPC stream). Kept as a flat
 * shape (rather than a discriminated union) because the `type` field comes
 * straight from JSON and may carry events we don't model; the dispatcher
 * switches on `type` and ignores unknown ones.
 */
export interface PiStdoutEvent {
  type?: string;
  assistantMessageEvent?: AssistantDelta;
  messages?: unknown;
}
