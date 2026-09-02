import { randomUUID } from "node:crypto";

import type {
  ReactorRecord,
  ReactorScope,
  ReactorSpec,
  RunIngress,
} from "@tangent/shared/contracts.ts";

import type { ReactorStore } from "../store/reactorStore.ts";
import type { MessageFacts } from "./reaction.ts";
import {
  initialState,
  markDue,
  type ReactorClock,
  reactorFor,
  systemClock,
} from "./reactor.ts";

/** Everything the engine needs to wake a reactor's participant in its home. */
export interface ReactorWake {
  sessionId: string;
  participantId: string;
  conversationId: string;
  text: string;
  ingress: RunIngress;
  /** The Message that made the reactor ready, for wave inheritance. Absent for a
   * timer-driven wake, which starts a fresh chain. */
  stimulus?: MessageFacts;
}

/** How the registry delivers a wake. Provided by the fan-out engine, which owns
 * the wave budget and the connector lookup. Returns whether it was delivered. */
export type WakeDelivery = (wake: ReactorWake) => Promise<boolean>;

/** What installing a reactor requires. `homeConversationId` lives on the scope. */
export interface InstallReactorInput {
  sessionId: string;
  participantId: string;
  spec: ReactorSpec;
  scope: ReactorScope;
}

/** A reactor's inspectable state — its config and whether it would fire now. */
export interface ReactorView {
  id: string;
  participantId: string;
  homeConversationId: string;
  spec: ReactorSpec;
  scope: ReactorScope;
  state: ReactorRecord["state"];
  ready: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function conversationsOf(scope: ReactorScope): Set<string> {
  return new Set(scope.memberships.map((member) => member.conversationId));
}

/** Rejects a scope that is not a coherent set held by one Participant. Returns
 * whether it is a single Conversation, which the time-driven specs require. */
function validateScope(input: InstallReactorInput): boolean {
  const { scope, participantId } = input;
  if (scope.memberships.length === 0) {
    throw new Error("A reactor scope must hold at least one membership.");
  }
  if (!scope.homeConversationId) {
    throw new Error("A reactor scope must declare its home Conversation.");
  }
  const foreign = scope.memberships.find(
    (member) => member.participantId !== participantId,
  );
  if (foreign) {
    throw new Error(
      "A reactor's scope memberships must all be held by the installing participant.",
    );
  }
  return conversationsOf(scope).size === 1;
}

/** A deadline or debounce is time-dependent, so the merge-order rule forbids it
 * on a set: it is only defined over a single membership. */
function validateSingleMembership(spec: ReactorSpec, single: boolean): void {
  const timed = spec.name === "awaitDeadline" || spec.name === "debounce";
  if (timed && !single) {
    throw new Error(
      `${spec.name} is only defined over a single-membership scope.`,
    );
  }
}

/** A quorum needs a reachable threshold over a non-empty set. */
function validateQuorum(spec: ReactorSpec): void {
  if (spec.name !== "awaitQuorum") return;
  if (spec.n < 1 || spec.of.length === 0) {
    throw new Error("awaitQuorum needs n >= 1 over a non-empty set.");
  }
}

/** awaitAll and firstOf must name something to count. */
function validateCompletionTargets(spec: ReactorSpec): void {
  if (spec.name !== "awaitAll" && spec.name !== "firstOf") return;
  const targets = (spec.participants ?? []).length + (spec.runs ?? []).length;
  if (targets === 0) {
    throw new Error(`${spec.name} must name at least one target.`);
  }
}

/** Rejects a scope that cannot be a coherent reactor before anything persists. */
function validate(input: InstallReactorInput): void {
  const single = validateScope(input);
  validateSingleMembership(input.spec, single);
  validateQuorum(input.spec);
  validateCompletionTargets(input.spec);
}

/**
 * Who is waiting on what, and where it wakes (unified-model §9.3). Owns the
 * durable state of every installed {@link Reactor}: it folds `observe` over each
 * Message in scope, persists the result, and — when `ready` — asks the fan-out
 * engine to wake the participant in its home Conversation. State lives here, not
 * in a predicate's closure, which is exactly what makes it listable and
 * replayable for the later workflow view.
 */
export class ReactorRegistry {
  private readonly store: ReactorStore;
  private readonly clock: ReactorClock;
  /** Pending timers for time-driven reactors, so a re-arm cancels the last. */
  private readonly timers = new Map<string, () => void>();
  private wake?: WakeDelivery;

  constructor(store: ReactorStore, clock: ReactorClock = systemClock) {
    this.store = store;
    this.clock = clock;
  }

  /** Hands the registry the engine's wake delivery. Separate from the
   * constructor because the engine needs the registry that needs the engine. */
  useDelivery(wake: WakeDelivery): void {
    this.wake = wake;
  }

  async install(input: InstallReactorInput): Promise<ReactorRecord> {
    validate(input);
    const now = nowIso();
    const record: ReactorRecord = {
      id: randomUUID(),
      sessionId: input.sessionId,
      participantId: input.participantId,
      homeConversationId: input.scope.homeConversationId,
      spec: input.spec,
      scope: input.scope,
      state: initialState(input.spec),
      createdAt: now,
      updatedAt: now,
    };
    await this.store.put(record);
    this.arm(record);
    return record;
  }

  async remove(id: string): Promise<void> {
    this.timers.get(id)?.();
    this.timers.delete(id);
    await this.store.remove(id);
  }

  /**
   * Folds a Message into every reactor watching this Conversation, persists any
   * that advanced, and wakes any that became ready. Total by design: a Message
   * that wakes nobody is still observed, because a completion count depends on
   * seeing the ones you do not react to.
   */
  async observe(
    sessionId: string,
    conversationId: string,
    facts: MessageFacts,
  ): Promise<void> {
    const records = await this.store.listObserving(sessionId, conversationId);
    for (const record of records) {
      const reactor = reactorFor(record.spec);
      const next = reactor.observe(record.state, facts, record.participantId);
      if (next !== record.state) {
        record.state = next;
        record.updatedAt = nowIso();
        await this.store.put(record);
      }
      if (record.spec.name === "debounce") this.armDebounce(record);
      await this.fire(record, facts);
    }
  }

  /** A reactor's current config and whether it would fire now. */
  async inspect(id: string): Promise<ReactorView | undefined> {
    const record = await this.store.get(id);
    if (!record) return undefined;
    return {
      id: record.id,
      participantId: record.participantId,
      homeConversationId: record.homeConversationId,
      spec: record.spec,
      scope: record.scope,
      state: record.state,
      ready: reactorFor(record.spec).ready(record.state),
    };
  }

  async listForSession(sessionId: string): Promise<ReactorRecord[]> {
    return this.store.listForSession(sessionId);
  }

  async listForParticipant(
    sessionId: string,
    participantId: string,
  ): Promise<ReactorRecord[]> {
    return this.store.listForParticipant(sessionId, participantId);
  }

  /** Delivers a wake if the reactor is ready, then advances its state past the
   * wake. `onWake` runs only when the engine actually delivered, so a wake the
   * budget refused leaves the reactor ready to try again. */
  private async fire(
    record: ReactorRecord,
    stimulus?: MessageFacts,
  ): Promise<void> {
    const reactor = reactorFor(record.spec);
    if (!reactor.ready(record.state)) return;
    if (!this.wake) return;
    const delivered = await this.wake({
      sessionId: record.sessionId,
      participantId: record.participantId,
      conversationId: record.homeConversationId,
      text: wakeText(record),
      ingress: stimulus ? "reaction" : "schedule",
      stimulus,
    });
    if (!delivered) return;
    record.state = reactor.onWake(record.state);
    record.updatedAt = nowIso();
    await this.store.put(record);
  }

  /** Arms the timer a time-driven reactor needs at install. */
  private arm(record: ReactorRecord): void {
    if (record.spec.name === "awaitDeadline") {
      this.armAt(record, Date.parse(record.spec.at));
    }
  }

  /** (Re)arms a debounce timer for the quiet window after the last Message. */
  private armDebounce(record: ReactorRecord): void {
    if (record.spec.name !== "debounce") return;
    this.armAt(record, this.clock.now() + record.spec.windowMs);
  }

  private armAt(record: ReactorRecord, atMs: number): void {
    this.timers.get(record.id)?.();
    const cancel = this.clock.schedule(atMs, () => {
      void this.onTimer(record.id);
    });
    this.timers.set(record.id, cancel);
  }

  private async onTimer(id: string): Promise<void> {
    this.timers.delete(id);
    const record = await this.store.get(id);
    if (!record) return;
    record.state = markDue(record.state);
    record.updatedAt = nowIso();
    await this.store.put(record);
    await this.fire(record);
  }
}

/** A short, body-free notice of why a reactor woke — provenance, not content;
 * reading the watched threads is the context work of a later PR. */
function wakeText(record: ReactorRecord): string {
  const { spec, state } = record;
  const seen = state.kind === "await" ? state.seen.join(", ") : "";
  if (spec.name === "awaitAll") {
    return `All awaited participants have finished: ${seen}.`;
  }
  if (spec.name === "awaitQuorum") {
    return `Quorum reached: ${spec.n} of ${spec.of.length} have finished (${seen}).`;
  }
  if (spec.name === "firstOf") {
    return "A worker you were waiting on has finished first.";
  }
  if (spec.name === "awaitDeadline") {
    return "The deadline you set has passed.";
  }
  return "Activity has settled after the quiet window.";
}
