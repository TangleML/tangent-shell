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
  type TerminationCause,
} from "@tangent/shared/contracts.ts";
import type { Server } from "socket.io";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import { messageRoomFor } from "../sockets/rooms.ts";
import type { Membership } from "../store/membershipStore.ts";
import type { CatalogInput } from "../store/resourceStore.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import type { AdmissionEngine } from "./admission.ts";
import { describeCause } from "./causes.ts";
import type { CorrelationEngine } from "./correlation.ts";
import { FanOutEngine, type FanOutResult } from "./fanOut.ts";
import type { MembershipRegistry } from "./membershipRegistry.ts";
import { participantForConversation } from "./participantRegistry.ts";
import type { ReactorRegistry } from "./reactorRegistry.ts";
import type { ResourceCatalog } from "./resourceCatalog.ts";

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
  /** Marks this Message as a request awaiting an answer; the engine opens an
   * outstanding correlation for it. */
  correlationId?: string;
  /** The `correlationId` this Message answers, resolving that correlation. */
  inReplyTo?: string;
  /** The structured cause this Message is the system notice of, when one. */
  cause?: TerminationCause;
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
    correlationId: input.correlationId,
    inReplyTo: input.inReplyTo,
    cause: input.cause,
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
 * The text one recipient's transport receives for a Message. The participant
 * that owns the Conversation (its subject) gets the content as written; one
 * woken from another Conversation gets the provenance framing that used to be
 * baked into a wrapped relay string. Ownership is passed in rather than inferred
 * from the id, now that a Conversation id no longer equals its owner's id.
 * Framing is a projection, so what is persisted stays the author's own words.
 *
 * An opaque member is sent the Message plain as well: framing situates a
 * Message within a transcript, and a member that sees none of the log — an
 * A2A peer in a shared room — has nothing to situate it against.
 */
export function deliveryText(
  message: ChatMessage,
  recipient: Membership,
  ownerParticipantId: string,
): string {
  const body = withAttachments(message.content, message.attachments);
  if (recipient.participantId === ownerParticipantId) return body;
  if (recipient.transcriptVisibility === "opaque") return body;
  return `${frameFor(message, recipient)}\n\n${body}`;
}

/** The catalog entry a human attachment on a Message stands for. */
function attachmentResource(
  message: ChatMessage,
  attachment: Attachment,
): CatalogInput {
  const meta: Record<string, unknown> = { size: attachment.size };
  if (attachment.contentType) meta.contentType = attachment.contentType;
  return {
    sessionId: message.sessionId,
    kind: "attachment",
    name: attachment.name,
    uri: attachment.path,
    authorParticipantId: message.author.id,
    meta,
  };
}

/** The catalog entry a memory write surfaced in a Message stands for. */
function memoryResource(
  message: ChatMessage,
  scope: MemoryScope,
): CatalogInput {
  return {
    sessionId: message.sessionId,
    kind: "memory",
    name: scope === "global" ? "Global memory" : "Session memory",
    uri: `memory://${scope}`,
    authorParticipantId: message.author.id,
    meta: { scope },
  };
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
  /**
   * Catalogs the content a Message carries — attachments and memory writes — and
   * references it into this Conversation, so it surfaces as citable content
   * regardless of which connector produced it. Optional so a bare router (e.g. a
   * test) skips the mirror.
   */
  private readonly resources?: ResourceCatalog;
  /**
   * Holds the outstanding request/reply correlations a posted Message opens or
   * resolves. Optional so a bare router (e.g. a test) skips correlation.
   */
  private readonly correlations?: CorrelationEngine;
  private readonly engine: FanOutEngine;
  private connectors?: ConnectorRegistry;

  constructor(
    io: Server,
    store: SessionStore,
    memberships: MembershipRegistry,
    resources?: ResourceCatalog,
    reactors?: ReactorRegistry,
    correlations?: CorrelationEngine,
    admission?: AdmissionEngine,
  ) {
    this.io = io;
    this.store = store;
    this.memberships = memberships;
    this.resources = resources;
    this.correlations = correlations;
    this.engine = new FanOutEngine(
      memberships,
      () => this.requireConnectors(),
      (sessionId, conversationId, text, cause) =>
        this.postNotice(sessionId, conversationId, text, cause),
      reactors,
      admission,
    );
    // The engine owns the wave budget and the connector lookup a reactor wake
    // needs; the registry owns the folded state. Close the loop here.
    reactors?.useDelivery((wake) => this.engine.wakeReactor(wake));
    // A timed-out correlation surfaces as a system notice in the Conversation it
    // was asked in, posted back through this router.
    correlations?.useNotify((sessionId, conversationId, text, cause) =>
      this.postNotice(sessionId, conversationId, text, cause),
    );
  }

  /**
   * Posts a system notice carrying its structured cause, best-effort: a failure
   * to record why something stopped must not itself throw into the fan-out (or
   * the settle/timeout callback) that announced it, so it is logged, not left as
   * an unhandled rejection.
   */
  private postNotice(
    sessionId: string,
    conversationId: string,
    text: string,
    cause: TerminationCause,
  ): void {
    this.post({
      sessionId,
      conversationId,
      author: SYSTEM_AUTHOR,
      content: text,
      cause,
    }).catch((err) => {
      console.error(
        `[conversation] failed to post a system notice in ${conversationId}:`,
        err,
      );
    });
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
    await this.catalogContent(message);
    // A request opens a correlation and a reply resolves one — request/reply is
    // a fact about Messages, not a per-connector table.
    this.correlations?.openFromMessage(message);
    this.correlations?.resolve(message);
    this.broadcast(message, input.broadcast);
    if (input.provokes === false) {
      return { message, woke: [], refused: [] };
    }

    // The subject of this Conversation reads it plain; everyone else woken from
    // it gets provenance framing. Resolve the owner once for the whole fan-out.
    const owner = await participantForConversation(
      this.store,
      message.sessionId,
      message.conversationId,
    );
    const outcome = await this.engine.fanOut({
      message,
      ingress: input.ingress,
      delivery: input.delivery,
      project: (msg, recipient) => deliveryText(msg, recipient, owner),
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

  /**
   * Mirrors the content a Message carries into the resource catalog and
   * references it into this Conversation: each human attachment, and a memory
   * write's surfaced document. The bytes are untouched — this only records that
   * the content exists and appears here.
   */
  private async catalogContent(message: ChatMessage): Promise<void> {
    if (!this.resources) return;
    for (const attachment of message.attachments ?? []) {
      await this.resources.catalogIn(
        message.conversationId,
        attachmentResource(message, attachment),
      );
    }
    if (message.memory) {
      await this.resources.catalogIn(
        message.conversationId,
        memoryResource(message, message.memory.scope),
      );
    }
  }

  /**
   * The fan-out wave depth a participant currently holds, so a cause emitted
   * outside a fan-out (a settled Run, a dropped connection) can name the depth
   * it stopped at. `0` when the participant holds no chain.
   */
  waveDepth(sessionId: string, participantId: string): number {
    return this.engine.waveDepth(sessionId, participantId);
  }

  /**
   * Every live reaction chain in a session — each participant that holds one and
   * its current depth — so the workflow view can show a wave against its budget
   * (unified-model §9.8).
   */
  listWaves(sessionId: string): { participantId: string; depth: number }[] {
    return this.engine.listForSession(sessionId);
  }

  /**
   * Drops a participant's reaction chain once its Run has settled and nothing is
   * held behind it, so the workflow view stops reporting a finished cascade's
   * last depth. The caller owns the "settled and idle" decision.
   */
  evictWave(sessionId: string, participantId: string): void {
    this.engine.evictWave(sessionId, participantId);
  }

  /**
   * Posts a structured termination cause as a system Message in the Conversation
   * it names, the same shape the fan-out and correlation engines post. For a
   * cause discovered outside a fan-out — a Run settling `failed`, a connector
   * dropping — so a supervisor can react to it.
   */
  announceCause(sessionId: string, cause: TerminationCause): void {
    this.postNotice(
      sessionId,
      cause.conversationId,
      describeCause(cause),
      cause,
    );
  }

  private broadcast(
    message: ChatMessage,
    override?: (message: ChatMessage) => void,
  ): void {
    if (override) return override(message);
    this.io
      .to(messageRoomFor(message.sessionId, message.conversationId))
      .emit(SocketEvents.ChatMessage, message);
  }

  private requireConnectors(): ConnectorRegistry {
    if (!this.connectors) {
      throw new Error("ConversationRouter used before useConnectors()");
    }
    return this.connectors;
  }
}
