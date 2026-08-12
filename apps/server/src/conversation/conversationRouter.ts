import { randomUUID } from "node:crypto";

import {
  type Attachment,
  type ChatAuthor,
  type ChatMessage,
  type MemoryScope,
  type MessageDelivery,
  type MessageSource,
  type RunId,
  type RunIngress,
  SocketEvents,
  sourceFromAuthor,
  SYSTEM_AUTHOR,
} from "@tangent/shared/contracts.ts";
import type { Server } from "socket.io";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import { roomFor } from "../sockets/rooms.ts";
import type { Membership } from "../store/membershipStore.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { FanOutEngine, type FanOutResult } from "./fanOut.ts";
import type { MembershipRegistry } from "./membershipRegistry.ts";

/**
 * Everything a Message needs beyond its envelope defaults. `seq` comes from the
 * store's allocator unless a streaming turn already reserved one, which is what
 * stops a writer inventing an ordinal.
 */
export interface PostInput {
  sessionId: string;
  conversationId: string;
  author: ChatAuthor;
  content: string;
  id?: string;
  seq?: number;
  mentions?: string[];
  thinking?: string;
  attachments?: Attachment[];
  runId?: RunId;
  endsRun?: boolean;
  memory?: { scope: MemoryScope };
  /**
   * The Conversation the author wrote this from, when it is not this one. Set
   * only by {@link ConversationRouter.postToConversation}, and what makes the
   * Message's provenance a `relay` rather than an ordinary turn.
   */
  fromConversation?: string;
  /** What created this Message, when a reaction did not. */
  ingress?: RunIngress;
  /** Whether a mid-run delivery steers or queues behind the current turn. */
  delivery?: MessageDelivery;
  /**
   * Set false for output that must not wake anyone — a cancelled turn, whose
   * content is history rather than a request.
   */
  provokes?: boolean;
  /**
   * Broadcasts the Message. Defaults to `chat:message`; a streamed turn passes
   * its own `agent:end` payload so the client keeps replacing its placeholder.
   */
  broadcast?: (message: ChatMessage) => void;
}

/** The posted Message and what fanning it out did. */
export interface PostResult extends FanOutResult {
  message: ChatMessage;
}

/** Everything {@link ConversationRouter.postToConversation} needs. */
export interface CrossPostInput extends PostInput {
  fromConversation: string;
}

/**
 * A cross-Conversation post. `message` is absent when Membership did not
 * authorize it, in which case `refused` names the author and says why — a post
 * that never happened must not read like one that woke nobody.
 */
export interface CrossPostResult extends FanOutResult {
  message?: ChatMessage;
}

/** Fields an empty value must omit rather than persist as empty. */
function whatIsThere(input: PostInput): Partial<ChatMessage> {
  const fields: Partial<ChatMessage> = {};
  if (input.thinking) fields.thinking = input.thinking;
  if (input.attachments?.length) fields.attachments = input.attachments;
  if (input.memory) fields.memory = input.memory;
  return fields;
}

/**
 * Where a Message came from. A post written from another Conversation records
 * that it was, so the log can answer "did this arrive across a boundary"
 * instead of leaving the provenance to be reconstructed at delivery time.
 */
function sourceFor(input: PostInput): MessageSource {
  const { fromConversation } = input;
  // A Conversation is not somewhere else from itself.
  if (!fromConversation || fromConversation === input.conversationId) {
    return sourceFromAuthor(input.author);
  }
  return {
    kind: "relay",
    from: input.author.id,
    fromConversation,
  };
}

function buildMessage(input: PostInput & { seq: number }): ChatMessage {
  // `runId` and `endsRun` are written as given: an absent one is `undefined`,
  // which JSON drops on both the wire and the way to the log.
  return {
    id: input.id ?? randomUUID(),
    sessionId: input.sessionId,
    conversationId: input.conversationId,
    seq: input.seq,
    author: input.author,
    mentions: input.mentions ?? [],
    source: sourceFor(input),
    content: input.content,
    runId: input.runId,
    endsRun: input.endsRun,
    ...whatIsThere(input),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Appends the attached files by their workspace-relative path, so a recipient
 * knows they exist and can read them with its own file tools.
 */
function withAttachments(content: string, attachments?: Attachment[]): string {
  if (!attachments || attachments.length === 0) return content;
  const list = attachments.map((file) => `- ${file.path}`).join("\n");
  const intro =
    "The user attached the following files (paths are relative to your workspace):";
  return content ? `${content}\n\n${intro}\n${list}` : `${intro}\n${list}`;
}

/** How a recipient woken from someone else's Conversation is told whose it was. */
function frameFor(message: ChatMessage, recipient: Membership): string {
  const directed = message.mentions.includes(recipient.participantId);
  if (message.author.agentRole === "subagent") {
    const verb = directed ? "reported" : "replied";
    return `Sub-agent "${message.author.name}" ${verb}:`;
  }
  return `${message.author.name} posted in another conversation:`;
}

/**
 * The text one recipient's transport receives for a Message. A participant
 * reading its own Conversation gets the content as written; one woken from
 * another Conversation gets the provenance framing that used to be baked into a
 * wrapped relay string. Framing is a projection, so what is persisted stays the
 * author's own words.
 */
export function deliveryText(
  message: ChatMessage,
  recipient: Membership,
): string {
  const body = withAttachments(message.content, message.attachments);
  if (message.conversationId === recipient.participantId) return body;
  return `${frameFor(message, recipient)}\n\n${body}`;
}

/**
 * The one way a Message enters a Conversation: allocate its ordinal, persist it,
 * broadcast it, then let the fan-out engine decide who reacts. Nothing else
 * chooses a recipient — a caller says what happened and where, never who should
 * run because of it.
 */
export class ConversationRouter {
  private readonly io: Server;
  private readonly store: SessionStore;
  private readonly memberships: MembershipRegistry;
  private readonly engine: FanOutEngine;
  private connectors?: ConnectorRegistry;

  constructor(
    io: Server,
    store: SessionStore,
    memberships: MembershipRegistry,
  ) {
    this.io = io;
    this.store = store;
    this.memberships = memberships;
    this.engine = new FanOutEngine(
      memberships,
      () => this.requireConnectors(),
      (sessionId, conversationId, text) => {
        void this.post({
          sessionId,
          conversationId,
          author: SYSTEM_AUTHOR,
          content: text,
        });
      },
    );
  }

  /**
   * Hands the router the connector registry. Separate from the constructor
   * because the registry needs the event sink that needs the router: the cycle
   * is in the wiring, not in the dependency.
   */
  useConnectors(connectors: ConnectorRegistry): void {
    this.connectors = connectors;
  }

  async post(input: PostInput): Promise<PostResult> {
    const seq =
      input.seq ??
      (await this.store.nextSeq(input.sessionId, input.conversationId));
    const message = buildMessage({ ...input, seq });
    // Persist before broadcasting so a reconnecting client sees it in history.
    await this.store.appendMessage(message);
    this.broadcast(message, input.broadcast);
    if (input.provokes === false) {
      return { message, woke: [], refused: [] };
    }

    const outcome = await this.engine.fanOut({
      message,
      ingress: input.ingress,
      delivery: input.delivery,
      project: deliveryText,
    });
    return { message, ...outcome };
  }

  /**
   * Posts into a Conversation the author is not writing from — an orchestrator
   * reporting into the human's thread, or issuing a directive in a worker's.
   * A Run's output lands in its home Conversation by default, so writing
   * elsewhere is deliberate and has to be authorized: only a participant that
   * holds a Membership there may post there.
   *
   * The post stays in its author's wave whatever its ingress, which is what
   * stops two Conversations whose participants wake each other from laundering
   * an unbounded cycle by changing rooms.
   */
  async postToConversation(input: CrossPostInput): Promise<CrossPostResult> {
    if (input.fromConversation === input.conversationId) {
      return this.post(input);
    }

    const membership = await this.memberships.memberIn(
      input.sessionId,
      input.conversationId,
      input.author.id,
    );
    if (membership) return this.post(input);

    const reason = `${input.author.name} isn't a member of that conversation, so nothing was posted.`;
    console.log(
      `[conversation] refused a post by ${input.author.id} into ${input.conversationId}`,
    );
    return {
      woke: [],
      refused: [{ participantId: input.author.id, reason }],
    };
  }

  private broadcast(
    message: ChatMessage,
    override?: (message: ChatMessage) => void,
  ): void {
    if (override) return override(message);
    this.io
      .to(roomFor(message.sessionId))
      .emit(SocketEvents.ChatMessage, message);
  }

  private requireConnectors(): ConnectorRegistry {
    if (!this.connectors) {
      throw new Error("ConversationRouter used before useConnectors()");
    }
    return this.connectors;
  }
}
