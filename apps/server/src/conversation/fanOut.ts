import { randomUUID } from "node:crypto";

import type {
  ChatMessage,
  MessageDelivery,
  RunIngress,
} from "@tangent/shared/contracts.ts";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import type { Membership } from "../store/membershipStore.ts";
import { describeCause, type TerminationCause } from "./causes.ts";
import type { MembershipRegistry } from "./membershipRegistry.ts";
import { type MessageFacts, messageFacts, parseReaction } from "./reaction.ts";

/**
 * How many automatic reaction hops one chain may take. Deliberate work — a tool
 * call, a schedule, an inbound callback — starts a new chain, so this bounds
 * cascades rather than the length of an orchestration.
 */
const MAX_WAVE_DEPTH = 8;

/** How many reactions one chain may dispatch into a single Conversation. */
const MAX_CONVERSATION_REACTIONS = 24;

/** A chain of automatic reactions, and how far along it a Message sits. */
interface Wave {
  id: string;
  depth: number;
}

/** One Message to fan out, and how its recipients should read it. */
export interface FanOutRequest {
  message: ChatMessage;
  /** Set when something other than a reaction created this Message. */
  ingress?: RunIngress;
  /** Whether a mid-run delivery steers or queues behind the current turn. */
  delivery?: MessageDelivery;
  /** The text one recipient receives, projected from the envelope. */
  project: (message: ChatMessage, recipient: Membership) => string;
}

/** Posts a system notice into a Conversation. */
export type Notify = (
  sessionId: string,
  conversationId: string,
  text: string,
) => void;

/**
 * What a fan-out did. `refused` is what a sender needs: a participant that was
 * addressed and did not wake is the one outcome indistinguishable from success.
 */
export interface FanOutResult {
  woke: string[];
  refused: { participantId: string; reason: string }[];
}

function keyFor(sessionId: string, id: string): string {
  return `${sessionId}\u0000${id}`;
}

/** Marks every member a bound stopped as refused, with the reason it stopped. */
function refusedBy(
  members: Membership[],
  reason: string,
): FanOutResult["refused"] {
  return members.map((member) => ({
    participantId: member.participantId,
    reason,
  }));
}

/**
 * Evaluates a Conversation's memberships against a posted Message and delivers
 * to whoever reacts. This is the only thing that decides who runs: predicates
 * are configuration, so no call site chooses a recipient by inspecting the
 * transport or the sender's role.
 *
 * Because predicates are arbitrary code, termination cannot live in them. The
 * engine guarantees it instead: a participant never reacts to its own Message, a
 * system notice provokes nothing, and every automatic hop is counted against a
 * depth and a per-Conversation budget. Exhausting either is announced in the
 * Conversation — a bound that stops a cascade silently turns a runaway loop into
 * a stall.
 */
export class FanOutEngine {
  private readonly memberships: MembershipRegistry;
  private readonly connectors: () => ConnectorRegistry;
  private readonly notify: Notify;
  /** The wave each participant was last woken in, by session. */
  private readonly waves = new Map<string, Wave>();
  /** Reactions already dispatched into one Conversation within one wave. */
  private readonly spent = new Map<string, number>();
  /** Per-Conversation serialization, so one fan-out finishes before the next. */
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    memberships: MembershipRegistry,
    connectors: () => ConnectorRegistry,
    notify: Notify,
  ) {
    this.memberships = memberships;
    this.connectors = connectors;
    this.notify = notify;
  }

  /**
   * Queues a Message's fan-out behind whatever that Conversation is already
   * fanning out, so reactions are dispatched in the order Messages were
   * persisted. Deliberately arrival-ordered rather than strictly `seq`-ordered:
   * `seq` is monotonic but not gap-free, so waiting for a number a failed stream
   * spent would stall the Conversation forever.
   */
  fanOut(request: FanOutRequest): Promise<FanOutResult> {
    const { sessionId, conversationId } = request.message;
    const key = keyFor(sessionId, conversationId);
    const next = (this.queues.get(key) ?? Promise.resolve())
      .then(() => this.dispatch(request))
      .catch((err) => {
        console.error(
          `[conversation] fan-out failed in ${conversationId}:`,
          err,
        );
        return { woke: [], refused: [] };
      });
    this.queues.set(
      key,
      next.then(() => undefined),
    );
    return next;
  }

  private async dispatch(request: FanOutRequest): Promise<FanOutResult> {
    const { message } = request;
    const result: FanOutResult = { woke: [], refused: [] };
    // A notice about why something stopped is not itself a stimulus.
    if (message.source.kind === "system") return result;

    const members = await this.memberships.membersOf(
      message.sessionId,
      message.conversationId,
    );
    const facts = messageFacts(message);
    const reacting = members.filter((member) => this.reacts(member, facts));
    this.announceRefusals(message, members, facts, reacting, result);
    if (reacting.length === 0) return result;

    const wave = this.waveFor(message, request.ingress);
    if (wave.depth + 1 > MAX_WAVE_DEPTH) {
      const cause: TerminationCause = {
        kind: "wave-depth-exhausted",
        participantId: reacting[0].participantId,
        limit: MAX_WAVE_DEPTH,
      };
      this.announce(message, cause);
      result.refused.push(...refusedBy(reacting, describeCause(cause)));
      return result;
    }

    for (const member of reacting) {
      if (!this.spend(wave.id, message.conversationId)) {
        const cause: TerminationCause = {
          kind: "reaction-budget-exhausted",
          limit: MAX_CONVERSATION_REACTIONS,
        };
        this.announce(message, cause);
        result.refused.push(...refusedBy(reacting, describeCause(cause)));
        return result;
      }
      this.deliver(request, member, wave, result);
    }
    return result;
  }

  /** Whether a member acts on this Message. A participant never reacts to itself. */
  private reacts(member: Membership, facts: MessageFacts): boolean {
    if (member.participantId === facts.authorId) return false;
    if (member.participantId === facts.sourceFrom) return false;
    return parseReaction(member.reaction)(facts, member.participantId);
  }

  /** Wakes one member, recording the hop so its own output stays in this wave. */
  private deliver(
    request: FanOutRequest,
    member: Membership,
    wave: Wave,
    result: FanOutResult,
  ): void {
    const { message } = request;
    this.waves.set(keyFor(message.sessionId, member.participantId), {
      id: wave.id,
      depth: wave.depth + 1,
    });

    const { delivered, reason } = this.connectors()
      .resolve(message.sessionId, member.participantId)
      .deliver({
        sessionId: message.sessionId,
        participantId: member.participantId,
        text: request.project(message, member),
        ingress: request.ingress ?? member.ingress,
        delivery: request.delivery,
      });
    if (delivered) {
      result.woke.push(member.participantId);
      return;
    }
    // The connector already said why in the addressed conversation; the sender
    // hears it in the result.
    result.refused.push({
      participantId: member.participantId,
      reason: reason ?? "The message wasn't delivered.",
    });
  }

  /**
   * The wave a Message belongs to. Work a participant deliberately created, or
   * an outside signal, starts a fresh one: only automatic reactions accumulate
   * depth, so a long orchestration driven by tool calls is never cut short.
   */
  private waveFor(message: ChatMessage, ingress?: RunIngress): Wave {
    if (ingress && ingress !== "reaction")
      return { id: randomUUID(), depth: 0 };
    const inherited = this.waves.get(
      keyFor(message.sessionId, message.author.id),
    );
    return inherited ?? { id: randomUUID(), depth: 0 };
  }

  /** Charges one reaction to a wave's budget in a Conversation. */
  private spend(waveId: string, conversationId: string): boolean {
    const key = keyFor(waveId, conversationId);
    const used = this.spent.get(key) ?? 0;
    if (used >= MAX_CONVERSATION_REACTIONS) return false;
    this.spent.set(key, used + 1);
    return true;
  }

  /**
   * Says so when a Message addressed a member that declined to act. Being
   * mentioned by name and silently ignored is the one refusal a sender cannot
   * otherwise tell from success.
   */
  private announceRefusals(
    message: ChatMessage,
    members: Membership[],
    facts: MessageFacts,
    reacting: Membership[],
    result: FanOutResult,
  ): void {
    for (const member of members) {
      if (reacting.includes(member)) continue;
      if (member.participantId === facts.authorId) continue;
      if (!facts.mentions.includes(member.participantId)) continue;
      const cause: TerminationCause = {
        kind: "wake-refused",
        participantId: member.participantId,
      };
      this.announce(message, cause);
      result.refused.push({
        participantId: member.participantId,
        reason: describeCause(cause),
      });
    }
  }

  private announce(message: ChatMessage, cause: TerminationCause): void {
    this.notify(
      message.sessionId,
      message.conversationId,
      describeCause(cause),
    );
  }
}
