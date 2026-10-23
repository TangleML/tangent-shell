import type { AgentActivity } from "@tangent/shared/contracts.ts";
import type { RemoteAgentEvent } from "@tangent/shared/remoteSubagent.ts";

/**
 * One parsed line of `pi --mode rpc` stdout. Flat rather than a union because
 * `type` comes straight from JSON and may name events we don't model.
 */
export interface PiStdoutEvent {
  type?: string;
  assistantMessageEvent?: { type?: string; delta?: unknown };
  message?: { role?: string; content?: unknown };
  toolName?: string;
  args?: unknown;
  steering?: unknown;
  followUp?: unknown;
}

/** The in-flight assistant message of one pi process. */
export interface PiStreamState {
  messageId: string | null;
  /** `start` is deferred to the first delta so tool-only messages open no bubble. */
  startEmitted: boolean;
  accum: string;
  thinkingAccum: string;
}

export function createStreamState(): PiStreamState {
  return { messageId: null, startEmitted: false, accum: "", thinkingAccum: "" };
}

function resetMessage(state: PiStreamState): void {
  state.messageId = null;
  state.startEmitted = false;
  state.accum = "";
  state.thinkingAccum = "";
}

/** Parses one stdout line, or `null` when it is not a JSON object. */
export function parsePiLine(line: string): PiStdoutEvent | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (Array.isArray(parsed)) return null;
    return parsed as PiStdoutEvent;
  } catch {
    return null;
  }
}

const THINKING: AgentActivity = { kind: "thinking", label: "Thinking..." };

const activity = (value: AgentActivity | null): RemoteAgentEvent => ({
  type: "activity",
  activity: value,
});

function isAssistant(event: PiStdoutEvent): boolean {
  return event.message?.role === "assistant";
}

/** A `{ type: "text", text }` part of an assistant message's content array. */
function isTextPart(part: unknown): part is { type: "text"; text: string } {
  if (typeof part !== "object" || part === null) return false;
  const candidate = part as { type?: unknown; text?: unknown };
  return candidate.type === "text" && typeof candidate.text === "string";
}

/** Concatenated text parts of a finalized assistant message. */
function assistantText(message: PiStdoutEvent["message"]): string {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter(isTextPart)
    .map((part) => part.text)
    .join("");
}

function readDelta(
  raw: PiStdoutEvent["assistantMessageEvent"],
): { kind: "delta" | "thinking"; text: string } | null {
  if (!raw || typeof raw.delta !== "string") return null;
  if (raw.type === "text_delta") return { kind: "delta", text: raw.delta };
  if (raw.type === "thinking_delta") {
    return { kind: "thinking", text: raw.delta };
  }
  return null;
}

function stringArg(args: unknown, key: string): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const value = (args as Record<string, unknown>)[key];
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

const TOOL_VERBS: Record<string, [verb: string, argKey: string]> = {
  read: ["Reading", "path"],
  write: ["Writing", "path"],
  edit: ["Editing", "path"],
  ls: ["Listing", "path"],
  bash: ["Running", "command"],
  grep: ["Searching for", "pattern"],
  find: ["Finding", "pattern"],
};

export function toolActivityLabel(toolName: string, args: unknown): string {
  const [verb, argKey] = TOOL_VERBS[toolName] ?? [`Running ${toolName}`, ""];
  const target = argKey ? stringArg(args, argKey) : undefined;
  return target ? `${verb} ${target}` : verb;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

type Translator = (
  state: PiStreamState,
  event: PiStdoutEvent,
  newId: () => string,
) => RemoteAgentEvent[];

function onMessageStart(
  state: PiStreamState,
  event: PiStdoutEvent,
  newId: () => string,
): RemoteAgentEvent[] {
  if (!isAssistant(event)) return [];
  resetMessage(state);
  state.messageId = newId();
  return [];
}

function onMessageUpdate(
  state: PiStreamState,
  event: PiStdoutEvent,
): RemoteAgentEvent[] {
  const delta = readDelta(event.assistantMessageEvent);
  const messageId = state.messageId;
  if (!delta || !messageId) return [];

  const out: RemoteAgentEvent[] = [];
  if (!state.startEmitted) {
    state.startEmitted = true;
    out.push({ type: "start", messageId }, activity(null));
  }
  if (delta.kind === "delta") state.accum += delta.text;
  else state.thinkingAccum += delta.text;
  out.push({ type: delta.kind, messageId, delta: delta.text });
  return out;
}

function onMessageEnd(
  state: PiStreamState,
  event: PiStdoutEvent,
): RemoteAgentEvent[] {
  if (!isAssistant(event)) return [];
  const out: RemoteAgentEvent[] = [];
  if (state.messageId && state.startEmitted) {
    out.push({
      type: "end",
      messageId: state.messageId,
      content: assistantText(event.message) || state.accum,
      thinking: state.thinkingAccum,
    });
  }
  resetMessage(state);
  out.push(activity(THINKING));
  return out;
}

const TRANSLATORS: Record<string, Translator> = {
  agent_start: (state) => {
    resetMessage(state);
    return [activity(THINKING)];
  },
  message_start: onMessageStart,
  message_update: onMessageUpdate,
  message_end: onMessageEnd,
  tool_execution_start: (_state, event) => {
    const toolName = event.toolName ?? "tool";
    return [
      activity({
        kind: "tool",
        label: toolActivityLabel(toolName, event.args),
        toolName,
      }),
    ];
  },
  queue_update: (_state, event) => [
    {
      type: "queue",
      steering: toStringArray(event.steering),
      followUp: toStringArray(event.followUp),
    },
  ],
  agent_end: (state) => {
    resetMessage(state);
    return [activity(null)];
  },
};

/**
 * Translates one pi RPC event into the remote-env events it implies, updating
 * `state`. Mirrors the server's local pi relay so a sub-agent hosted here
 * renders the same as one hosted on the server. Unknown types yield nothing.
 */
export function translatePiEvent(
  state: PiStreamState,
  event: PiStdoutEvent,
  newId: () => string,
): RemoteAgentEvent[] {
  const translate = TRANSLATORS[event.type ?? ""];
  return translate ? translate(state, event, newId) : [];
}
