import type {
  ReactionSpec,
  ReactorSpec,
  ReactorState,
} from "@tangent/shared/contracts.ts";

import { type MessageFacts, parseReaction } from "./reaction.ts";

/**
 * A reaction with memory (unified-model §9.3). Where a {@link Reaction} decides
 * from the Message in hand, a Reactor folds a running state over every Message in
 * its scope and tests that state for readiness — so "waiting on 2 of 3" is a fact
 * the engine holds, not something recoverable only by re-reading a transcript.
 *
 * Three properties are load-bearing and all are about where state lives: the
 * engine owns `S` (not a closure), so it is serializable and inspectable;
 * `observe` is total (it sees Messages that wake nobody, because counting
 * completions requires it); and `ready` is separate from `observe`, so the wake
 * condition is readable without executing anything.
 */
export interface Reactor<S> {
  /** State before any Message has been observed. */
  initial: S;
  /** Folded over every Message in scope, in order. Returns the same reference
   * when nothing changed, so a caller can skip a redundant persist. */
  observe: (state: S, message: MessageFacts, self: string) => S;
  /** Whether this Participant should run now — a pure test of state. */
  ready: (state: S) => boolean;
  /** State carried forward once a wake fires. */
  onWake: (state: S) => S;
}

/**
 * Section 4.1's stateless predicate as a Reactor — `observe` keeps the last
 * Message and `ready` tests it, so every Phase 1 membership configuration is
 * already a Reactor and nothing had to be rewritten to adopt this. `self` is
 * closed over so `ready` stays a pure function of state, matching the model.
 */
export function fromReaction(
  spec: ReactionSpec,
  self: string,
): Reactor<MessageFacts | null> {
  const reacts = parseReaction(spec);
  return {
    initial: null,
    observe: (_state, message) => message,
    ready: (state) => state !== null && reacts(state, self),
    onWake: () => null,
  };
}

/** The completion ids a spec waits on: author ids and/or run ids. */
function targetsOf(spec: ReactorSpec): {
  participants: string[];
  runs: string[];
} {
  if (spec.name === "awaitAll" || spec.name === "firstOf") {
    return { participants: spec.participants ?? [], runs: spec.runs ?? [] };
  }
  if (spec.name === "awaitQuorum") return { participants: spec.of, runs: [] };
  return { participants: [], runs: [] };
}

/**
 * The id this Message completes, or nothing. A completion is a finalized turn
 * (`endsRun`) by an awaited participant, or a finalized turn of an awaited run —
 * whichever identity the caller declared it waits on.
 */
function completionId(
  message: MessageFacts,
  participants: string[],
  runs: string[],
): string | undefined {
  if (!message.endsRun) return undefined;
  if (participants.includes(message.authorId)) return message.authorId;
  if (message.runId && runs.includes(message.runId)) return message.runId;
  return undefined;
}

/** Adds an id to a `seen` set, returning the same array when already present. */
function withSeen(seen: string[], id: string): string[] {
  if (seen.includes(id)) return seen;
  return [...seen, id].sort();
}

/** Folds a completion into a `seen` set, or returns the same state unchanged. */
function foldSeen(
  state: ReactorState,
  message: MessageFacts,
  participants: string[],
  runs: string[],
): ReactorState {
  if (state.kind !== "await") return state;
  const id = completionId(message, participants, runs);
  if (!id) return state;
  const seen = withSeen(state.seen, id);
  return seen === state.seen ? state : { kind: "await", seen };
}

function awaitAllReactor(
  participants: string[],
  runs: string[],
): Reactor<ReactorState> {
  const expected = [...participants, ...runs];
  return {
    initial: { kind: "await", seen: [] },
    observe: (state, message) => foldSeen(state, message, participants, runs),
    ready: (state) =>
      state.kind === "await" && expected.every((id) => state.seen.includes(id)),
    onWake: () => ({ kind: "await", seen: [] }),
  };
}

function quorumReactor(
  participants: string[],
  n: number,
): Reactor<ReactorState> {
  return {
    initial: { kind: "await", seen: [] },
    observe: (state, message) => foldSeen(state, message, participants, []),
    ready: (state) => state.kind === "await" && state.seen.length >= n,
    onWake: () => ({ kind: "await", seen: [] }),
  };
}

function firstOfReactor(
  participants: string[],
  runs: string[],
): Reactor<ReactorState> {
  return {
    initial: { kind: "first", fired: false },
    observe: (state, message) => {
      if (state.kind !== "first" || state.fired) return state;
      return completionId(message, participants, runs)
        ? { kind: "first", fired: true }
        : state;
    },
    ready: (state) => state.kind === "first" && state.fired,
    onWake: () => ({ kind: "first", fired: false }),
  };
}

function deadlineReactor(): Reactor<ReactorState> {
  return {
    initial: { kind: "deadline", due: false },
    observe: (state) => state,
    ready: (state) => state.kind === "deadline" && state.due,
    onWake: () => ({ kind: "deadline", due: false }),
  };
}

function superviseReactor(): Reactor<ReactorState> {
  return {
    initial: { kind: "cause", fired: false },
    observe: (state, message) => {
      if (state.kind !== "cause" || state.fired) return state;
      return message.cause ? { kind: "cause", fired: true } : state;
    },
    ready: (state) => state.kind === "cause" && state.fired,
    onWake: () => ({ kind: "cause", fired: false }),
  };
}

function debounceReactor(): Reactor<ReactorState> {
  return {
    initial: { kind: "debounce", lastSeq: 0, due: false },
    observe: (state, message) =>
      state.kind === "debounce"
        ? { kind: "debounce", lastSeq: message.seq, due: false }
        : state,
    ready: (state) => state.kind === "debounce" && state.due,
    onWake: (state) =>
      state.kind === "debounce"
        ? { kind: "debounce", lastSeq: state.lastSeq, due: false }
        : state,
  };
}

/**
 * Builds the {@link Reactor} a stored {@link ReactorSpec} names. Its state is
 * JSON-serializable ({@link ReactorState}) and every `ready` over a set is
 * completion-counting, so it is insensitive to the merge order of independently
 * ordered Conversation logs (§9.3). `awaitDeadline` and `debounce` are driven by
 * the registry's clock rather than by a Message, so their `observe` only records
 * position; readiness is flipped by a timer.
 */
/** A reactor that folds a set of completions (by participant or run). */
type SetSpec = Extract<
  ReactorSpec,
  { name: "awaitAll" | "awaitQuorum" | "firstOf" }
>;

function isSetSpec(spec: ReactorSpec): spec is SetSpec {
  return (
    spec.name === "awaitAll" ||
    spec.name === "awaitQuorum" ||
    spec.name === "firstOf"
  );
}

function setReactor(spec: SetSpec): Reactor<ReactorState> {
  if (spec.name === "awaitQuorum") {
    return quorumReactor(targetsOf(spec).participants, spec.n);
  }
  const { participants, runs } = targetsOf(spec);
  return spec.name === "awaitAll"
    ? awaitAllReactor(participants, runs)
    : firstOfReactor(participants, runs);
}

export function reactorFor(spec: ReactorSpec): Reactor<ReactorState> {
  if (isSetSpec(spec)) return setReactor(spec);
  switch (spec.name) {
    case "awaitDeadline":
      return deadlineReactor();
    case "debounce":
      return debounceReactor();
    case "supervise":
      return superviseReactor();
    default: {
      // A corrupt or unrecognized spec must not silently degrade to a debounce:
      // that would install a reactor that watches nothing and never fires. The
      // exhaustive `never` makes a new ReactorName a compile error here.
      const unreachable: never = spec;
      throw new Error(
        `Unknown reactor spec: ${JSON.stringify(unreachable as ReactorSpec)}`,
      );
    }
  }
}

/** The initial folded state a freshly installed reactor starts from. */
export function initialState(spec: ReactorSpec): ReactorState {
  return reactorFor(spec).initial;
}

/** Marks a time-driven reactor's state as due, so its next `ready` fires. */
export function markDue(state: ReactorState): ReactorState {
  if (state.kind === "deadline") return { kind: "deadline", due: true };
  if (state.kind === "debounce")
    return { kind: "debounce", lastSeq: state.lastSeq, due: true };
  return state;
}

/**
 * How a reactor reads its own clock. Injected so deadline and debounce are
 * testable against a fake clock rather than a real timer.
 */
export interface ReactorClock {
  now(): number;
  /** Runs `fn` at or after `atMs`; returns a cancel for the pending callback. */
  schedule(atMs: number, fn: () => void): () => void;
}

/** The real clock: `Date.now` and an unref'd `setTimeout` that never holds the
 * process open. */
export const systemClock: ReactorClock = {
  now: () => Date.now(),
  schedule: (atMs, fn) => {
    const timer = setTimeout(fn, Math.max(0, atMs - Date.now()));
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};
