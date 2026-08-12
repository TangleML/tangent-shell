import { randomUUID } from "node:crypto";

import {
  type ConnectorCredential,
  mintSecretCredential,
} from "../connectors/credentials.ts";

/**
 * A relay channel bridges an external MCP client (which the gateway dials) to a
 * session's Prime agent. It is opened by a bundle extension over the internal
 * API, its `url` is handed to the remote peer, and every tool call the peer
 * makes on that channel is relayed to `sessionId`'s Prime. Generic by design:
 * this holds no knowledge of what remote runtime is on the other end.
 */
export interface RelayChannel {
  channelId: string;
  sessionId: string;
  /** Human label used when relaying messages to Prime (e.g. the peer's name). */
  label: string;
  /**
   * The Participant this channel speaks for, when one owns it. A channel a
   * connector opened for a participant reports **as** that participant, in its
   * own Conversation; an unowned one has no standing anywhere and can only be
   * relayed to Prime.
   */
  participantId?: string;
  /** The credential this channel — and only this channel — is opened by. */
  credential: ConnectorCredential;
  /** Open questions awaiting an answer, keyed by request id. */
  pending: Map<string, { question: string; createdAt: number }>;
  /** Answers supplied for pending questions, keyed by request id. */
  answers: Map<string, string>;
  createdAt: number;
}

export interface OpenChannelInput {
  sessionId: string;
  label?: string;
  /** The Participant the channel belongs to, when a connector owns it. */
  participantId?: string;
}

export interface PendingQuestion {
  request_id: string;
  question: string;
}

/**
 * In-memory registry of relay channels. State is intentionally ephemeral: a
 * channel only makes sense while its session's Prime process is alive, and the
 * external peer re-establishes on restart via a freshly opened channel.
 */
export class RelayRegistry {
  private readonly channels = new Map<string, RelayChannel>();

  /** Opens a channel bound to `sessionId`, returning its id and bearer secret. */
  open(input: OpenChannelInput): { channelId: string; secret: string } {
    const channelId = randomUUID().replace(/-/g, "");
    const credential = mintSecretCredential();
    this.channels.set(channelId, {
      channelId,
      sessionId: input.sessionId,
      label: input.label?.trim() || "remote agent",
      participantId: input.participantId,
      credential,
      pending: new Map(),
      answers: new Map(),
      createdAt: Date.now(),
    });
    return { channelId, secret: credential.secret };
  }

  get(channelId: string): RelayChannel | undefined {
    return this.channels.get(channelId);
  }

  /** Registers a question awaiting an answer. */
  addQuestion(channelId: string, requestId: string, question: string): void {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    channel.pending.set(requestId, { question, createdAt: Date.now() });
  }

  /** Records an answer for a pending question. Returns whether it was open. */
  answer(channelId: string, requestId: string, text: string): boolean {
    const channel = this.channels.get(channelId);
    if (!channel) return false;
    const wasPending = channel.pending.has(requestId);
    channel.answers.set(requestId, text);
    return wasPending;
  }

  /** Consumes an answer if present, clearing the matching pending question. */
  takeAnswer(channelId: string, requestId: string): string | undefined {
    const channel = this.channels.get(channelId);
    if (!channel) return undefined;
    const answer = channel.answers.get(requestId);
    if (answer === undefined) return undefined;
    channel.answers.delete(requestId);
    channel.pending.delete(requestId);
    return answer;
  }

  /** Lists open questions for a channel (oldest first). */
  pending(channelId: string): PendingQuestion[] {
    const channel = this.channels.get(channelId);
    if (!channel) return [];
    return [...channel.pending.entries()]
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .map(([request_id, value]) => ({ request_id, question: value.question }));
  }

  close(channelId: string): boolean {
    return this.channels.delete(channelId);
  }
}
