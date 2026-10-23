import { randomUUID } from "node:crypto";

import type {
  ContentBlock,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import type { RemoteAgentEvent } from "@tangent/shared/remoteSubagent.ts";

/** One `session/update`'s payload — the discriminated update union. */
type Update = SessionNotification["update"];

/**
 * The `session/update` kinds {@link TurnStreamer.apply} turns into events.
 * Every other variant is ignored, so the attach stream drops them before the
 * SDK validates them — keeping logs clean as adapters add new update kinds.
 */
export const CONSUMED_SESSION_UPDATES = new Set<string>([
  "agent_message_chunk",
  "agent_thought_chunk",
  "tool_call",
  "tool_call_update",
]);

/** The text of a content block, or "" for image/audio/resource blocks. */
function contentText(content: ContentBlock): string {
  return content.type === "text" ? content.text : "";
}

/** A tool-call status that means the call is over and should stop spinning. */
function isSettled(status: string | null | undefined): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

/** The last value a Map holds in insertion order, or undefined when empty. */
function lastValue(map: Map<string, string>): string | undefined {
  let last: string | undefined;
  for (const value of map.values()) last = value;
  return last;
}

/**
 * Turns one ACP turn's `session/update` stream into Tangent agent events. A
 * turn is one `session/prompt`: the first content opens the message, assistant
 * text and thinking stream as deltas, and tool calls surface as a transient
 * activity indicator that follows their lifecycle. {@link end} closes the
 * bubble with everything the turn said.
 *
 * The streamer owns the turn's `messageId`, so start/delta/end all carry the
 * same id the way a local agent's stream does.
 */
export class TurnStreamer {
  readonly messageId = randomUUID();
  private started = false;
  private content = "";
  private thinking = "";
  /** In-flight tool calls by id, in start order; the last is what shows. */
  private readonly activeTools = new Map<string, string>();
  /** The label currently shown (null = cleared), so we emit only on change. */
  private shownLabel: string | null = null;

  /** The events one update yields, in order. */
  apply(update: Update): RemoteAgentEvent[] {
    if (update.sessionUpdate === "agent_message_chunk") {
      return this.message(contentText(update.content));
    }
    if (update.sessionUpdate === "agent_thought_chunk") {
      return this.thought(contentText(update.content));
    }
    if (
      update.sessionUpdate === "tool_call" ||
      update.sessionUpdate === "tool_call_update"
    ) {
      return this.toolCall(update.toolCallId, update.title, update.status);
    }
    return [];
  }

  /** Streams one chunk of assistant text, opening the bubble on first sight. */
  private message(text: string): RemoteAgentEvent[] {
    if (!text) return [];
    this.content += text;
    return [
      ...this.open(),
      { type: "delta", messageId: this.messageId, delta: text },
    ];
  }

  /** Streams one chunk of the agent's thinking. */
  private thought(text: string): RemoteAgentEvent[] {
    if (!text) return [];
    this.thinking += text;
    return [{ type: "thinking", messageId: this.messageId, delta: text }];
  }

  /**
   * Tracks one tool call's lifecycle. A settled status drops it; any other
   * (re)states it as in-flight. The indicator then reflects the most recent
   * in-flight call, or clears when none remain — so a finished call stops
   * spinning at once instead of lingering until the whole turn ends.
   */
  private toolCall(
    id: string,
    title: string | null | undefined,
    status: string | null | undefined,
  ): RemoteAgentEvent[] {
    if (!id) return [];
    if (isSettled(status)) this.activeTools.delete(id);
    else if (title) this.activeTools.set(id, title);
    else if (!this.activeTools.has(id)) return [];
    return this.syncActivity();
  }

  /** Emits an activity event only when the shown indicator actually changes. */
  private syncActivity(): RemoteAgentEvent[] {
    const next = lastValue(this.activeTools) ?? null;
    if (next === this.shownLabel) return [];
    this.shownLabel = next;
    return [
      {
        type: "activity",
        activity: next ? { kind: "tool", label: next } : null,
      },
    ];
  }

  /**
   * The `start` event, emitted once before the first delta. Any tool indicator
   * is dropped here: once the agent's answer streams, the bubble is the visual.
   */
  private open(): RemoteAgentEvent[] {
    if (this.started) return [];
    this.started = true;
    this.activeTools.clear();
    return [
      { type: "start", messageId: this.messageId },
      ...this.syncActivity(),
    ];
  }

  /**
   * Closes the turn: the `end` bubble when assistant text opened one, then a
   * final activity clear so no tool indicator outlives the turn (ACP has no
   * run-end event, so an unsettled last call would otherwise keep spinning).
   */
  end(): RemoteAgentEvent[] {
    const events: RemoteAgentEvent[] = [];
    if (this.started) {
      events.push({
        type: "end",
        messageId: this.messageId,
        content: this.content,
        thinking: this.thinking,
      });
    }
    this.activeTools.clear();
    events.push(...this.syncActivity());
    return events;
  }
}
