/**
 * Wire contracts for the **remote sub-agent** transport: the Socket.IO protocol
 * between the dev server's `RemoteEnvironmentGateway` and a connected remote
 * environment (the `@tangent/remote-subagent` SDK).
 *
 * A remote environment is an alternative *host* for sub-agents. Where a local
 * sub-agent is a `pi` child process driven over stdin/stdout, a remote
 * sub-agent lives inside a connected environment that receives the same
 * orchestration commands (`spawn` / `message` / `kill` / read transcript) and
 * streams the same events back. Both the server gateway and the SDK import
 * these shapes so the wire never drifts.
 */

import type {
  AgentActivity,
  ChatMessage,
  MessageDelivery,
  Resource,
  RunId,
  SubagentStatus,
  ThinkingLevel,
} from "./contracts.ts";

/**
 * Socket.IO namespace a remote environment connects to. Kept distinct from the
 * default namespace the browser UI uses so the two audiences never collide.
 */
export const REMOTE_ENV_NAMESPACE = "/remote-env";

/**
 * Credentials a remote environment presents in the Socket.IO connection
 * `auth` payload. The gateway validates `token` against its configured
 * `REMOTE_ENV_TOKEN` before accepting the connection, and uses `environmentId`
 * to address commands at a specific environment when several are connected.
 */
export interface RemoteEnvHandshake {
  environmentId: string;
  token: string;
}

/**
 * Socket.IO event names for the remote sub-agent protocol. Server->remote names
 * carry orchestration commands; remote->server names carry streamed events,
 * roster transitions, reports to Prime, and ack-style transcript reads.
 */
export const RemoteEnvEvents = {
  /** server -> remote: create a sub-agent in the remote environment. */
  Spawn: "remote:spawn",
  /** server -> remote: deliver a directed message/task to a sub-agent. */
  Message: "remote:message",
  /** server -> remote: terminate a sub-agent. */
  Kill: "remote:kill",
  /** remote -> server: a streamed agent event (start/delta/end/...). */
  AgentEvent: "remote:agent-event",
  /** remote -> server: a sub-agent's lifecycle status change. */
  SubagentUpdate: "remote:subagent-update",
  /** remote -> server: a sub-agent's directed report to Prime. */
  AgentMessage: "remote:agent-message",
  /** remote -> server (ack): read the shared session transcript. */
  RoomRead: "remote:room:read",
  /** remote -> server: (re)declare the tool catalog this environment offers. */
  ToolsRegister: "remote:tools:register",
  /** server -> remote (ack): invoke one registered tool and await its result. */
  ToolsCall: "remote:tools:call",
} as const;

export type RemoteEnvEvent =
  (typeof RemoteEnvEvents)[keyof typeof RemoteEnvEvents];

/**
 * server -> remote: create a sub-agent. The server resolves the effective
 * config (tools/prompt/model/thinking) before sending, so the remote
 * environment receives a fully-resolved spec and never needs the server's
 * template/bundle machinery.
 */
export interface RemoteSpawnCommand {
  sessionId: string;
  /** Server-assigned id; the remote environment must echo it on every event. */
  agentId: string;
  name: string;
  /** Resolved tool allowlist. */
  tools: string[];
  /** Resolved appended system prompt. */
  systemPrompt: string;
  /** Resolved `provider/model` id, or undefined to use the environment default. */
  model?: string;
  /** Resolved thinking depth, or undefined to use the environment default. */
  thinkingDepth?: ThinkingLevel;
  /** Template the sub-agent was resolved from, if any (informational). */
  template?: string;
  /**
   * @deprecated No longer sent. An initial task is a Message posted into the new
   * sub-agent's Conversation, so it arrives as an ordinary
   * {@link RemoteMessageCommand} immediately after this one. Kept so an
   * environment built against the older command still type-checks.
   */
  task?: string;
  /** Whether Prime reacts to this sub-agent's finalized replies. */
  autoRelayToPrime: boolean;
  /** @deprecated No longer sent; the initial task's command carries its own Run. */
  runId?: RunId;
}

/** server -> remote: deliver a directed message/task to a remote sub-agent. */
export interface RemoteMessageCommand {
  sessionId: string;
  agentId: string;
  text: string;
  delivery: MessageDelivery;
  /** The Run this message is work for, to echo back on its events. */
  runId?: RunId;
}

/** server -> remote: terminate a remote sub-agent. */
export interface RemoteKillCommand {
  sessionId: string;
  agentId: string;
  /** True when the sub-agent finished its work (vs. being aborted). */
  completed: boolean;
}

/**
 * A streamed event from a remote sub-agent. Mirrors the server's internal
 * streaming union so the gateway can translate it straight into the existing
 * chat-relay path: `start`/`delta`/`end` of a single assistant message are
 * correlated by `messageId`.
 */
export type RemoteAgentEvent =
  | { type: "start"; messageId: string }
  | { type: "delta"; messageId: string; delta: string }
  | { type: "thinking"; messageId: string; delta: string }
  | { type: "end"; messageId: string; content: string; thinking: string }
  | { type: "error"; messageId?: string; message: string }
  | { type: "activity"; activity: AgentActivity | null }
  | { type: "queue"; steering: string[]; followUp: string[] };

/** remote -> server: a streamed {@link RemoteAgentEvent}, tagged with its agent. */
export interface RemoteAgentEventPayload {
  sessionId: string;
  agentId: string;
  event: RemoteAgentEvent;
  /**
   * The Run this event belongs to, echoed from the command that started the
   * work. Optional: an environment that doesn't echo it (or predates run
   * attribution) still streams, and the server attributes the event to whatever
   * Run that participant has open.
   */
  runId?: RunId;
}

/** remote -> server: a remote sub-agent's lifecycle status change. */
export interface RemoteSubagentUpdatePayload {
  sessionId: string;
  agentId: string;
  status: SubagentStatus;
}

/**
 * remote -> server: a remote sub-agent's directed report to Prime (the
 * `message_prime` equivalent). Surfaced in the sub-agent's own thread and
 * relayed into Prime.
 */
export interface RemoteAgentMessagePayload {
  sessionId: string;
  agentId: string;
  text: string;
}

/** remote -> server (ack request): read the shared session transcript. */
export interface RemoteRoomReadRequest {
  sessionId: string;
  /** Max number of most recent messages to return. */
  limit?: number;
  /**
   * Opt into a per-Membership context projection of one Conversation
   * (unified-model §9.6): with both set, the reply is that Conversation seen
   * through `participantId`'s `transcriptVisibility`. Omitting them keeps the
   * session-wide tail.
   */
  conversationId?: string;
  participantId?: string;
}

/** server -> remote (ack response): the tail of the shared session transcript. */
export interface RemoteRoomReadResponse {
  messages: ChatMessage[];
  /** Digest Resources standing in for summarized ranges, when the read was
   * projected through a `summarized` Membership. */
  digests?: Resource[];
}

/**
 * One tool a remote environment offers. It is a named async function the
 * environment implements, not a participant: the server routes a call to the
 * environment and hands the result back to the agent that asked, without a
 * Conversation, roster entry, or second LLM. `inputSchema` is JSON Schema so an
 * agent's tool runtime can validate arguments before the call.
 */
export interface RemoteToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * remote -> server: the full tool catalog this environment offers for a session.
 * Idempotent and total — each register replaces the environment's prior catalog,
 * and an empty `tools` clears it. Disconnecting drops it entirely.
 */
export interface RemoteToolsRegisterPayload {
  sessionId: string;
  tools: RemoteToolDef[];
}

/**
 * server -> remote (ack request): invoke one registered tool. `agentId` names
 * the agent (Prime or a local sub-agent) that called it, so the environment can
 * attribute or scope the work; `callId` correlates the ack.
 */
export interface RemoteToolCallRequest {
  callId: string;
  sessionId: string;
  agentId: string;
  name: string;
  arguments: unknown;
}

/**
 * remote -> server (ack response): the outcome of one tool call. `result` is any
 * JSON-serializable value (typically a string); `error` is set instead when the
 * environment could not run the tool.
 */
export interface RemoteToolCallResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}
