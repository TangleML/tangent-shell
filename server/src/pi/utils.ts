import path from "node:path";
import { StringDecoder } from "node:string_decoder";

import type { SubagentInfo } from "@shared/contracts.ts";

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
export function readDelta(raw: AssistantDelta | undefined): NormalizedDelta | null {
  if (!raw || typeof raw.delta !== "string") return null;
  if (raw.type === "text_delta") return { kind: "delta", text: raw.delta };
  if (raw.type === "thinking_delta") return { kind: "thinking", text: raw.delta };
  return null;
}

/** Builds the descriptor that tags events with their producing agent. */
export function toDescriptor(agent: AgentProcess): AgentDescriptor {
  return { agentId: agent.agentId, role: agent.role, name: agent.name };
}

/** Maps an internal process record to the roster shape exposed to the UI. */
export function toSubagentInfo(agent: AgentProcess): SubagentInfo {
  return {
    id: agent.agentId,
    name: agent.name,
    status: agent.status,
    ...(agent.template ? { template: agent.template } : {}),
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

/** Pulls the last assistant message's text out of an `agent_end` event. */
export function extractLastAssistantText(event: {
  messages?: unknown;
}): string | undefined {
  if (!Array.isArray(event.messages)) return undefined;
  for (let i = event.messages.length - 1; i >= 0; i--) {
    const text = assistantText(event.messages[i]);
    if (text) return text;
  }
  return undefined;
}
