import path from "node:path";
import { StringDecoder } from "node:string_decoder";

import { connectorFor, type SubagentInfo } from "@tangent/shared/contracts.ts";

import type {
  AgentDescriptor,
  AgentProcess,
  AssistantDelta,
  PiStdoutEvent,
} from "./types.ts";

/** Absolute path to the orchestrator extension loaded into every Pi process. */
export const ORCHESTRATOR_EXTENSION = path.join(
  import.meta.dirname,
  "extensions",
  "orchestrator.ts",
);

/**
 * Absolute path to the proxy-provider extension loaded into every Pi process.
 * It registers Pi's providers against the LLM proxy (base from `PI_PROXY_URL`),
 * which is required in environments without an auto-discovered `~/.pi/agent`
 * provider config (e.g. the Cloud Run container where `HOME=/tmp`).
 */
export const PROXY_PROVIDER_EXTENSION = path.join(
  import.meta.dirname,
  "extensions",
  "proxyProvider.ts",
);

/**
 * Absolute path to the memory extension loaded into every Pi process. It
 * registers the `read_memory` / `remember` / `suggest_memory` tools that read
 * and (for Prime) mutate the session and global memory stores.
 */
export const MEMORY_EXTENSION = path.join(
  import.meta.dirname,
  "extensions",
  "memory.ts",
);

/**
 * Absolute path to the resources extension loaded into every Pi process. It
 * registers the `read_resources` tool so any agent can re-read the host
 * resources the embedding app attached, which can change after spawn.
 */
export const RESOURCES_EXTENSION = path.join(
  import.meta.dirname,
  "extensions",
  "resources.ts",
);

/**
 * Absolute path to the triggers extension loaded into every Pi process. It
 * registers Prime-only tools to create, list, enable, disable, and delete the
 * session's triggers (schedule + callback) when the user asks.
 */
export const TRIGGERS_EXTENSION = path.join(
  import.meta.dirname,
  "extensions",
  "triggers.ts",
);

/**
 * Absolute path to the session extension loaded into every Pi process. It
 * registers the Prime-only `rename_session` tool, letting Prime give the
 * session a concise, conversation-derived name.
 */
export const SESSION_EXTENSION = path.join(
  import.meta.dirname,
  "extensions",
  "session.ts",
);

/**
 * Absolute path to the remote-tools extension loaded into every Pi process. It
 * registers the `list_remote_tools` / `call_remote_tool` dispatcher so any agent
 * can invoke the RPC tools a connected remote environment offers, without
 * spawning a browser sub-agent.
 */
export const REMOTE_TOOLS_EXTENSION = path.join(
  import.meta.dirname,
  "extensions",
  "remoteTools.ts",
);

/** Drops a single optional trailing CR from a line. */
function stripTrailingCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * Emits every complete LF-delimited line in `buffer` (trailing CR stripped,
 * empty lines skipped) and returns the unterminated remainder.
 */
function drainLines(buffer: string, onLine: (line: string) => void): string {
  let rest = buffer;
  while (true) {
    const newlineIndex = rest.indexOf("\n");
    if (newlineIndex === -1) break;

    const line = stripTrailingCr(rest.slice(0, newlineIndex));
    rest = rest.slice(newlineIndex + 1);
    if (line.length > 0) onLine(line);
  }
  return rest;
}

/**
 * Reads a stream as strict JSONL: records are delimited by LF only, with an
 * optional trailing CR stripped. Node's `readline` is intentionally avoided
 * because it also splits on U+2028/U+2029, which are valid inside JSON strings.
 */
export function attachJsonlReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): void {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  stream.on("data", (chunk: Buffer | string) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    buffer = drainLines(buffer, onLine);
  });

  stream.on("end", () => {
    buffer += decoder.end();
    if (buffer.length > 0) onLine(stripTrailingCr(buffer));
  });
}

/** Parses one stdout line as a Pi RPC event, or `null` if it isn't valid JSON. */
export function parsePiEvent(line: string): PiStdoutEvent | null {
  try {
    return JSON.parse(line) as PiStdoutEvent;
  } catch {
    return null;
  }
}

/** A normalized streaming delta, mapped to its {@link AgentEvent} variant. */
export interface NormalizedDelta {
  kind: "delta" | "thinking";
  text: string;
}

/**
 * Normalizes a raw `message_update` delta into the streaming variant the chat
 * layer understands, or `null` for deltas we don't surface.
 */
export function readDelta(
  raw: AssistantDelta | undefined,
): NormalizedDelta | null {
  if (!raw || typeof raw.delta !== "string") return null;
  if (raw.type === "text_delta") return { kind: "delta", text: raw.delta };
  if (raw.type === "thinking_delta")
    return { kind: "thinking", text: raw.delta };
  return null;
}

/** Builds the descriptor that tags events with their producing agent. */
export function toDescriptor(agent: AgentProcess): AgentDescriptor {
  return {
    agentId: agent.agentId,
    role: agent.role,
    name: agent.name,
    homeConversationId: agent.homeConversationId,
  };
}

/** Maps an internal process record to the roster shape exposed to the UI. */
export function toSubagentInfo(agent: AgentProcess): SubagentInfo {
  return {
    id: agent.agentId,
    conversationId: agent.homeConversationId,
    name: agent.name,
    status: agent.status,
    connector: connectorFor("pi-stdio"),
    ...(agent.template ? { template: agent.template } : {}),
    ...(agent.config.model ? { model: agent.config.model } : {}),
    ...(agent.config.thinkingDepth
      ? { thinkingDepth: agent.config.thinkingDepth }
      : {}),
    createdAt: agent.createdAt,
  };
}

interface AssistantMessage {
  role: "assistant";
  content: Array<{ type?: string; text?: string }>;
}

function isAssistantMessage(message: unknown): message is AssistantMessage {
  if (typeof message !== "object" || message === null) return false;
  const { role, content } = message as Partial<AssistantMessage>;
  return role === "assistant" && Array.isArray(content);
}

/** Concatenates the text parts of an assistant message, if it has any. */
function assistantText(message: unknown): string | undefined {
  if (!isAssistantMessage(message)) return undefined;
  const text = message.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  return text || undefined;
}

/** True when a `message_*` event's message is an assistant message. */
export function isAssistantRole(
  message: { role?: string } | undefined,
): boolean {
  return message?.role === "assistant";
}

/**
 * Extracts the final text of a `message_end` assistant message. Authoritative
 * over the streamed accumulator, which can miss late or non-streamed parts.
 */
export function assistantTextFromMessage(message: unknown): string | undefined {
  return assistantText(message);
}

/** Max length of an arg hint before it is ellipsized in the activity label. */
const MAX_HINT_LENGTH = 80;

/** Returns a trimmed non-empty string, or undefined. */
function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Collapses whitespace and ellipsizes a hint so labels stay single-line. */
function truncateHint(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_HINT_LENGTH
    ? `${oneLine.slice(0, MAX_HINT_LENGTH - 3)}...`
    : oneLine;
}

/**
 * Composes `verb + target`, e.g. `Reading src/app.ts`. Falls back to
 * `verb + fallback` (or just `verb`) when the target arg is absent.
 */
function labelWith(
  verb: string,
  target: string | undefined,
  fallback: string,
  sep = " ",
): string {
  if (target) return `${verb}${sep}${truncateHint(target)}`;
  return fallback ? `${verb} ${fallback}` : verb;
}

/** Describes a `grep` call: pattern plus the file scope being searched. */
function grepLabel(a: Record<string, unknown>): string {
  const pattern = str(a.pattern);
  const scope = str(a.glob) ?? str(a.path);
  const base = pattern
    ? `Searching for "${truncateHint(pattern)}"`
    : "Searching files";
  return scope ? `${base} in ${truncateHint(scope)}` : base;
}

/** First non-empty string argument, used as a hint for unknown tools. */
function genericHint(a: Record<string, unknown>): string | undefined {
  for (const value of Object.values(a)) {
    const hint = str(value);
    if (hint) return hint;
  }
  return undefined;
}

type ArgFormatter = (a: Record<string, unknown>) => string;

/**
 * Per-tool formatters that turn a tool call's arguments into a descriptive,
 * present-tense phrase describing exactly what the agent is doing.
 */
const TOOL_FORMATTERS: Record<string, ArgFormatter> = {
  read: (a) => labelWith("Reading", str(a.path), "a file"),
  write: (a) => labelWith("Writing", str(a.path), "a file"),
  edit: (a) => labelWith("Editing", str(a.path), "a file"),
  bash: (a) => labelWith("Running", str(a.command), "a command", ": "),
  grep: grepLabel,
  find: (a) => labelWith("Finding", str(a.pattern) ?? str(a.path), "files"),
  ls: (a) => labelWith("Listing", str(a.path), "the directory"),
  read_room: () => "Reading the room transcript",
  spawn_subagent: (a) => labelWith("Spawning sub-agent", str(a.name), ""),
  message_subagent: (a) =>
    labelWith("Messaging sub-agent", str(a.name) ?? str(a.id), ""),
  kill_subagent: (a) =>
    labelWith("Stopping sub-agent", str(a.name) ?? str(a.id), ""),
  list_subagents: () => "Listing sub-agents",
  read_memory: () => "Reading memory",
  remember: (a) => labelWith("Remembering", str(a.text), ""),
  suggest_memory: (a) => labelWith("Suggesting to remember", str(a.text), ""),
  create_trigger: (a) => labelWith("Creating trigger", str(a.name), ""),
  list_triggers: () => "Listing triggers",
  enable_trigger: (a) =>
    labelWith("Enabling trigger", str(a.name) ?? str(a.id), ""),
  disable_trigger: (a) =>
    labelWith("Disabling trigger", str(a.name) ?? str(a.id), ""),
  delete_trigger: (a) =>
    labelWith("Deleting trigger", str(a.name) ?? str(a.id), ""),
  rename_session: (a) => labelWith("Renaming session", str(a.name), ""),
};

/**
 * Builds the descriptive label shown in the ephemeral activity bubble for a
 * running tool, naming the tool and (where cheap) its concrete target so the
 * user sees what the agent is doing rather than a generic "Working...".
 */
export function toolActivityLabel(toolName: string, args: unknown): string {
  const a =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)
      : {};

  const formatter = TOOL_FORMATTERS[toolName];
  if (formatter) return formatter(a);

  const hint = genericHint(a);
  return hint
    ? `Running ${toolName}: ${truncateHint(hint)}`
    : `Running ${toolName}`;
}
