import { randomUUID } from "node:crypto";

import type {
  ChatMessage,
  MessageDelivery,
  RunIngress,
} from "@tangent/shared/contracts.ts";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import type { DeliveryRequest } from "../connectors/types.ts";
import type { Membership } from "../store/membershipStore.ts";
import type { AdmissionEngine } from "./admission.ts";
import { describeCause, type TerminationCause } from "./causes.ts";
import type { MembershipRegistry } from "./membershipRegistry.ts";
import { type MessageFacts, messageFacts } from "./reaction.ts";
import { fromReaction } from "./reactor.ts";
import type { ReactorRegistry, ReactorWake } from "./reactorRegistry.ts";

/**
 * How many hops one chain may take. Deliberate work — a tool call, a schedule,
 * an inbound callback — starts a new chain, so this bounds cascades rather than
 * the length of an orchestration. A cross-Conversation post is the exception:
 * it stays in its author's chain however it was made, and each round trip
 * between two participants spends two hops.
 */
export const MAX_WAVE_DEPTH = 24;

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

/** Posts a system notice into a Conversation, carrying the structured cause it
 * describes so a Reactor can observe the failure without parsing the text. */
export type Notify = (
  sessionId: string,
  conversationId: string,
  text: string,
  cause: TerminationCause,
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
  /** Stateful reactors folded over every Message, or absent when none are wired. */
  private readonly reactors?: ReactorRegistry;
  /** Decides what a wake does mid-Run (queue/coalesce/preempt/reject), or absent
   * when no admission policy is wired — every wake then delivers immediately. */
  private readonly admission?: AdmissionEngine;
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
    reactors?: ReactorRegistry,
    admission?: AdmissionEngine,
  ) {
    this.memberships = memberships;
    this.connectors = connectors;
    this.notify = notify;
    this.reactors = reactors;
    this.admission = admission;
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
    const next = (this.queues.get(key) ?? Promise.resolve()).then(() =>
      this.dispatch(request),
    );
    // The Conversation's queue must outlive a failed fan-out, so it chains on a
    // settled promise: one crash cannot poison the ordering of every later post.
    // The caller still sees the rejection through `next`, rather than a crash
    // masquerading as "nobody woke, nobody refused".
    this.queues.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private async dispatch(request: FanOutRequest): Promise<FanOutResult> {
    const { message } = request;
    const result: FanOutResult = { woke: [], refused: [] };
    const facts = messageFacts(message);
    await this.observeReactors(message, facts);

    // A notice about why something stopped is not itself a stimulus for the
    // membership fan-out, even though a reactor may have observed it above.
    if (message.source.kind === "system") return result;

    const members = await this.memberships.membersOf(
      message.sessionId,
      message.conversationId,
    );
    const reacting = members.filter((member) => this.reacts(member, facts));
    this.announceRefusals(message, members, facts, reacting, result);
    if (reacting.length === 0) return result;

    const wave = this.waveFor(message, request.ingress);
    if (wave.depth + 1 > MAX_WAVE_DEPTH) {
      const cause: TerminationCause = {
        kind: "budget-exhausted",
        budget: "wave-depth",
        limit: MAX_WAVE_DEPTH,
        participantId: reacting[0].participantId,
        conversationId: message.conversationId,
        waveDepth: wave.depth,
      };
      this.announce(message, cause);
      result.refused.push(...refusedBy(reacting, describeCause(cause)));
      return result;
    }

    for (let i = 0; i < reacting.length; i += 1) {
      const member = reacting[i];
      if (!this.spend(wave.id, message.conversationId)) {
        const cause: TerminationCause = {
          kind: "budget-exhausted",
          budget: "conversation-reactions",
          limit: MAX_CONVERSATION_REACTIONS,
          participantId: member.participantId,
          conversationId: message.conversationId,
          waveDepth: wave.depth,
        };
        this.announce(message, cause);
        // Only the members that did not get a slot are refused; the earlier ones
        // are already in `result.woke` and must not read as both woke and refused.
        result.refused.push(
          ...refusedBy(reacting.slice(i), describeCause(cause)),
        );
        return result;
      }
      this.deliver(request, member, wave, result);
    }
    return result;
  }

  /** Folds a Message into every installed reactor watching this Conversation.
   * Total — system notices included — because a completion count depends on
   * seeing the Messages that wake nobody. A no-op when no registry is wired. */
  private async observeReactors(
    message: ChatMessage,
    facts: MessageFacts,
  ): Promise<void> {
    if (!this.reactors) return;
    await this.reactors.observe(
      message.sessionId,
      message.conversationId,
      facts,
    );
  }

  /**
   * Whether a member acts on this Message. A participant never reacts to itself.
   * The predicate runs through its Reactor form — the stateless `Reactor<void>`
   * of §4.1 — so membership reaction and reactor memory are one mechanism.
   */
  private reacts(member: Membership, facts: MessageFacts): boolean {
    if (member.muted) return false;
    if (member.participantId === facts.authorId) return false;
    if (member.participantId === facts.sourceFrom) return false;
    const reactor = fromReaction(member.reaction, member.participantId);
    return reactor.ready(
      reactor.observe(reactor.initial, facts, member.participantId),
    );
  }

  /** Wakes one member, recording the hop so its own output stays in this wave.
   * A wake arriving while the member has an open Run is admitted by its
   * Membership's policy: delivered now, held until the Run settles, or refused
   * with a cause. */
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

    const deliveryRequest: DeliveryRequest = {
      sessionId: message.sessionId,
      participantId: member.participantId,
      conversationId: message.conversationId,
      text: request.project(message, member),
      ingress: request.ingress ?? member.ingress,
      delivery: request.delivery,
    };
    const performNow = () =>
      this.connectors()
        .resolve(message.sessionId, member.participantId)
        .deliver(deliveryRequest);

    const decision = this.admission?.admit({
      sessionId: message.sessionId,
      participantId: member.participantId,
      conversationId: message.conversationId,
      policy: member.admission,
      waveDepth: wave.depth,
      deliver: () => this.deferredDeliver(member.participantId, performNow),
    }) ?? { action: "now" as const };

    if (decision.action === "rejected") {
      this.announce(message, decision.cause);
      result.refused.push({
        participantId: member.participantId,
        reason: describeCause(decision.cause),
      });
      return;
    }
    if (decision.action === "held") {
      result.woke.push(member.participantId);
      return;
    }
    this.deliverNow(member.participantId, performNow, result);
  }

  /** Delivers now and records the outcome. A refusal is what a sender needs to
   * hear: the connector already said why in the addressed conversation. */
  private deliverNow(
    participantId: string,
    performNow: () => { delivered: boolean; reason?: string },
    result: FanOutResult,
  ): void {
    const { delivered, reason } = performNow();
    if (delivered) {
      result.woke.push(participantId);
      return;
    }
    result.refused.push({
      participantId,
      reason: reason ?? "The message wasn't delivered.",
    });
  }

  /** Runs a delivery the admission engine deferred to a Run's settle. The sender
   * has long since had its result, so a refusal here is only logged. */
  private deferredDeliver(
    participantId: string,
    performNow: () => { delivered: boolean; reason?: string },
  ): void {
    const { delivered, reason } = performNow();
    if (delivered) return;
    console.log(
      `[conversation] deferred wake for ${participantId} refused: ${reason ?? ""}`,
    );
  }

  /**
   * Wakes a ready reactor's participant in its home Conversation. Charged against
   * the same wave budget an ordinary reaction is: a message-driven wake inherits
   * the stimulus author's chain so a join cannot launder depth by hopping into a
   * quiet home, and a timer-driven one (no stimulus) starts a fresh chain the way
   * a schedule does. Refusing to deliver leaves the reactor ready to try again.
   */
  async wakeReactor(wake: ReactorWake): Promise<boolean> {
    const wave = this.reserveWakeWave(wake);
    if (!wave) return false;

    this.waves.set(keyFor(wake.sessionId, wake.participantId), wave);
    const deliveryRequest: DeliveryRequest = {
      sessionId: wake.sessionId,
      participantId: wake.participantId,
      conversationId: wake.conversationId,
      text: wake.text,
      ingress: wake.ingress,
    };
    const performNow = () =>
      this.connectors()
        .resolve(wake.sessionId, wake.participantId)
        .deliver(deliveryRequest);

    const decision = await this.admitReactorWake(wake, wave, performNow);
    if (decision.action === "rejected") {
      this.announceIn(wake.sessionId, wake.conversationId, decision.cause);
      return false;
    }
    if (decision.action === "held") return true;

    const { delivered, reason } = performNow();
    if (!delivered) {
      console.log(
        `[conversation] reactor wake for ${wake.participantId} refused: ${reason ?? ""}`,
      );
    }
    return delivered;
  }

  /** Admits a reactor wake against the target's Membership policy, the same as
   * an ordinary reaction. A wake into a Conversation the target holds no
   * membership in (none derived yet) defaults to delivering now. */
  private async admitReactorWake(
    wake: ReactorWake,
    wave: Wave,
    performNow: () => { delivered: boolean; reason?: string },
  ) {
    if (!this.admission) return { action: "now" as const };
    const member = await this.memberships.memberIn(
      wake.sessionId,
      wake.conversationId,
      wake.participantId,
    );
    return this.admission.admit({
      sessionId: wake.sessionId,
      participantId: wake.participantId,
      conversationId: wake.conversationId,
      policy: member?.admission ?? "queue",
      waveDepth: wave.depth,
      deliver: () => this.deferredDeliver(wake.participantId, performNow),
    });
  }

  /** The wave a wake would run in, or nothing when depth or budget refuses it —
   * announced in the home Conversation, so a stalled join says why. */
  private reserveWakeWave(wake: ReactorWake): Wave | undefined {
    const inherited = wake.stimulus
      ? this.waves.get(keyFor(wake.sessionId, wake.stimulus.authorId))
      : undefined;
    const base = inherited ?? { id: randomUUID(), depth: 0 };

    if (base.depth + 1 > MAX_WAVE_DEPTH) {
      this.announceIn(wake.sessionId, wake.conversationId, {
        kind: "budget-exhausted",
        budget: "wave-depth",
        limit: MAX_WAVE_DEPTH,
        participantId: wake.participantId,
        conversationId: wake.conversationId,
        waveDepth: base.depth,
      });
      return undefined;
    }
    if (!this.spend(base.id, wake.conversationId)) {
      this.announceIn(wake.sessionId, wake.conversationId, {
        kind: "budget-exhausted",
        budget: "conversation-reactions",
        limit: MAX_CONVERSATION_REACTIONS,
        participantId: wake.participantId,
        conversationId: wake.conversationId,
        waveDepth: base.depth,
      });
      return undefined;
    }
    return { id: base.id, depth: base.depth + 1 };
  }

  /**
   * The wave a Message belongs to. Work a participant deliberately created, or
   * an outside signal, starts a fresh one: only automatic reactions accumulate
   * depth, so a long orchestration driven by tool calls is never cut short.
   *
   * A post written from another Conversation is exempt. Its depth travels with
   * it whatever created it, because otherwise two Conversations whose
   * participants each wake the other launder an unbounded cycle by hopping
   * rooms while each individual room stays under budget.
   */
  private waveFor(message: ChatMessage, ingress?: RunIngress): Wave {
    const inherited = this.waves.get(
      keyFor(message.sessionId, message.author.id),
    );
    if (message.source.fromConversation) {
      return inherited ?? { id: randomUUID(), depth: 0 };
    }
    if (ingress && ingress !== "reaction")
      return { id: randomUUID(), depth: 0 };
    return inherited ?? { id: randomUUID(), depth: 0 };
  }

  /** The depth of the wave a participant was last woken in, or `0` when it holds
   * no chain — the wave depth a structured cause names, read by the engines that
   * emit one outside a fan-out (admission on release, a settled Run, a detach). */
  waveDepth(sessionId: string, participantId: string): number {
    return this.waves.get(keyFor(sessionId, participantId))?.depth ?? 0;
  }

  /**
   * Ends a participant's chain once its Run has settled and nothing is held for
   * it. Without this the last depth lingers forever, so `GET /workflow` reports a
   * finished cascade sitting at depth 24. The caller owns the "settled and idle"
   * decision; this only drops the state. A wave's per-Conversation budget is
   * shared across its riders, so it is reclaimed only when the last one leaves.
   */
  evictWave(sessionId: string, participantId: string): void {
    const key = keyFor(sessionId, participantId);
    const wave = this.waves.get(key);
    if (!wave) return;
    this.waves.delete(key);
    for (const other of this.waves.values()) {
      if (other.id === wave.id) return;
    }
    const prefix = `${wave.id}\u0000`;
    for (const spentKey of this.spent.keys()) {
      if (spentKey.startsWith(prefix)) this.spent.delete(spentKey);
    }
  }

  /** Every live wave in a session — each participant that holds a chain and the
   * depth it was last woken at, for the workflow view (unified-model §9.8). */
  listForSession(
    sessionId: string,
  ): { participantId: string; depth: number }[] {
    const prefix = `${sessionId}\u0000`;
    const waves: { participantId: string; depth: number }[] = [];
    for (const [key, wave] of this.waves) {
      if (!key.startsWith(prefix)) continue;
      waves.push({
        participantId: key.slice(prefix.length),
        depth: wave.depth,
      });
    }
    return waves;
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
        conversationId: message.conversationId,
        waveDepth: this.waveDepth(message.sessionId, member.participantId),
      };
      this.announce(message, cause);
      result.refused.push({
        participantId: member.participantId,
        reason: describeCause(cause),
      });
    }
  }

  private announce(message: ChatMessage, cause: TerminationCause): void {
    this.announceIn(message.sessionId, message.conversationId, cause);
  }

  private announceIn(
    sessionId: string,
    conversationId: string,
    cause: TerminationCause,
  ): void {
    this.notify(sessionId, conversationId, describeCause(cause), cause);
  }
}
