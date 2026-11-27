import { randomUUID } from "node:crypto";

import {
  type AwaitingInput,
  type ChatAnswer,
  type ChatMessage,
  type ChatQuestion,
  type ChatQuestionClosed,
  type PendingQuestion,
  PI_AGENT,
  type QuestionCloseReason,
  type QuestionItem,
  SYSTEM_AUTHOR,
} from "@tangent/shared/contracts.ts";
import {
  answerError,
  answerText,
  applyToPending,
  MAX_PENDING_QUESTIONS,
  questionFallbackText,
} from "@tangent/shared/questions.ts";
import { z } from "zod";

import type { RunRegistry } from "../runs/runRegistry.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import type { PostInput, PostResult } from "./conversationRouter.ts";
import { orchestratorIdentity } from "./participantRegistry.ts";

export const DEFAULT_QUESTION_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_QUESTION_TTL_MS = 60 * 1000;
const MAX_QUESTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface QuestionClock {
  now(): number;
  /** Runs `fn` at or after `atMs`; returns a cancel. */
  schedule(atMs: number, fn: () => void): () => void;
}

const systemClock: QuestionClock = {
  now: () => Date.now(),
  schedule: (atMs, fn) => {
    const timer = setTimeout(fn, Math.max(0, atMs - Date.now()));
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};

/** What Prime's `ask_question` tool sends, already schema-validated. */
export interface AskInput {
  sessionId: string;
  questions: QuestionItem[];
  peopleOnly?: boolean;
  expiresInSeconds?: number;
  idempotencyKey?: string;
}

export type AskOutcome =
  | { ok: true; question: ChatQuestion; messageId: string; reused: boolean }
  | { ok: false; error: string };

/** What {@link QuestionRegistry.cancel} did: closed it, found it already
 * closed (or unknown), or left it to an answer being posted. */
export type CancelOutcome = "cancelled" | "closed" | "answering";

export type AnswerCheck =
  | { ok: true; pending: PendingQuestion; content: string }
  | { ok: false; error: string };

type Post = (input: PostInput) => Promise<PostResult>;

/**
 * Gets a session's Prime ready to be woken by an expired question, resolving
 * whether it should be: an asleep (archived) session isn't woken.
 */
export type QuestionWaker = (sessionId: string) => Promise<boolean>;

interface SessionState {
  pending: Map<string, PendingQuestion>;
  /** Idempotency key -> the question id it asked. */
  keys: Map<string, string>;
  timers: Map<string, () => void>;
  /** Asks validated but not yet posted, counted against the pending cap. */
  asking: number;
  /** Questions an answer has claimed but not yet posted. */
  answering: Set<string>;
}

const MAX_OTHER_CHARS = 4_000;

const MAX_ATTESTATION_CHARS = 200;
const attestationField = z.string().trim().min(1).max(MAX_ATTESTATION_CHARS);

const answerSchema = z.object({
  answers: z
    .array(
      z.object({
        id: z.string(),
        selected: z.array(z.string()).default([]),
        other: z.string().max(MAX_OTHER_CHARS).optional(),
      }),
    )
    .max(4),
  answeredBy: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("person") }),
      z.object({
        kind: z.literal("relayed"),
        by: attestationField,
        ref: attestationField,
      }),
    ])
    .optional(),
});

/**
 * Reads an answer off an untrusted socket payload, keeping only the fields
 * the contract defines. `undefined` when it isn't shaped like one.
 */
export function parseAnswer(raw: unknown): ChatAnswer | undefined {
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const { answeredBy } = parsed.data;
  return {
    answers: parsed.data.answers.map(({ id, selected, other }) => {
      const text = other?.trim();
      return text ? { id, selected, other: text } : { id, selected };
    }),
    ...(answeredBy ? { answeredBy } : {}),
  };
}

/**
 * Prime's structured questions, folded from the transcript. The transcript is
 * the store: the pending set is rebuilt from a session's Messages on first
 * use, then kept current by {@link observe} on every post, so questions
 * survive a restart. Closing a question is itself a Message (an answer, or a
 * `questionClosed` system notice), so every client can run the same fold.
 *
 * A question closes when a person answers it, when Prime cancels it, or when
 * it expires; a person's plain message leaves it open, and Prime is reminded
 * of it with that message (see the router's delivery projection). Expiry is
 * the backstop that keeps `awaitingInput` from sticking, and the only close
 * that wakes Prime: it asked and is still owed an outcome.
 */
export class QuestionRegistry {
  private readonly store: SessionStore;
  private readonly runs?: RunRegistry;
  private readonly clock: QuestionClock;
  private readonly sessions = new Map<string, SessionState>();
  /**
   * Sessions evicted with nothing pending. A question only enters through
   * {@link ask}, which folds first, so these need no fold to say "none".
   */
  private readonly idle = new Set<string>();
  private readonly loading = new Map<string, Promise<SessionState>>();
  private readonly buffered = new Map<string, ChatMessage[]>();
  private post?: Post;
  private wake?: QuestionWaker;
  private onChange?: (sessionId: string) => void;

  constructor(
    store: SessionStore,
    runs?: RunRegistry,
    clock: QuestionClock = systemClock,
  ) {
    this.store = store;
    this.runs = runs;
    this.clock = clock;
  }

  /** Wires the router, which calls {@link observe} back on every post. */
  usePoster(post: Post): void {
    this.post = post;
  }

  /** Wires how an expired question wakes Prime; without it nothing is woken. */
  useWaker(wake: QuestionWaker): void {
    this.wake = wake;
  }

  /** Called whenever a session's pending count may have changed. */
  useOnChange(onChange: (sessionId: string) => void): void {
    this.onChange = onChange;
  }

  /**
   * Rebuilds every awake session's pending set at boot, so the lobby status
   * and expiry timers are right before anyone opens them. An archived session
   * is folded when it is next used.
   */
  async loadAll(): Promise<void> {
    for (const session of await this.store.listSessions()) {
      if (session.archived) continue;
      const state = await this.stateFor(session.id);
      this.evictIfIdle(session.id, state);
    }
  }

  private stateFor(sessionId: string): Promise<SessionState> {
    const loaded = this.sessions.get(sessionId);
    if (loaded) return Promise.resolve(loaded);
    const inFlight = this.loading.get(sessionId);
    if (inFlight) return inFlight;
    const promise = this.fold(sessionId).finally(() =>
      this.loading.delete(sessionId),
    );
    this.loading.set(sessionId, promise);
    return promise;
  }

  /**
   * The session's state for a caller about to change it. A read that shared
   * the same fold may have evicted it while this caller waited, so it refolds
   * until it holds the state the registry keeps; the caller's change then
   * happens in the same tick, before anything can evict it again.
   */
  private async liveState(sessionId: string): Promise<SessionState> {
    for (;;) {
      const state = await this.stateFor(sessionId);
      if (this.sessions.get(sessionId) === state) return state;
    }
  }

  private async fold(sessionId: string): Promise<SessionState> {
    this.buffered.set(sessionId, []);
    const messages = await this.store.getMessages(sessionId);
    const seen = new Set(messages.map((message) => message.id));
    const late = (this.buffered.get(sessionId) ?? []).filter(
      (message) => !seen.has(message.id),
    );
    this.buffered.delete(sessionId);

    const state = foldState([...messages, ...late]);
    this.sessions.set(sessionId, state);
    this.idle.delete(sessionId);
    for (const entry of [...state.pending.values()]) {
      this.arm(sessionId, state, entry);
    }
    if (state.pending.size > 0) this.onChange?.(sessionId);
    return state;
  }

  /** Folds a just-posted Message in. */
  observe(message: ChatMessage): void {
    const state = this.sessions.get(message.sessionId);
    if (!state) return this.buffer(message);
    const closed = applyToPending(state.pending, message);
    const asked = this.armAsked(state, message);
    this.settleClosed(state, closed);
    if (!asked && closed.length === 0) return;
    this.onChange?.(message.sessionId);
    this.evictIfIdle(message.sessionId, state);
  }

  /**
   * Forgets a session with nothing pending or in flight, so idle sessions hold
   * no memory; the next use folds its transcript again.
   */
  private evictIfIdle(sessionId: string, state: SessionState): void {
    const busy =
      state.pending.size > 0 || state.asking > 0 || state.answering.size > 0;
    if (!busy && this.sessions.get(sessionId) === state) {
      this.sessions.delete(sessionId);
      this.idle.add(sessionId);
    }
  }

  private buffer(message: ChatMessage): void {
    this.buffered.get(message.sessionId)?.push(message);
  }

  private armAsked(state: SessionState, message: ChatMessage): boolean {
    const id = message.question?.id;
    const entry = id ? state.pending.get(id) : undefined;
    if (entry) this.arm(message.sessionId, state, entry);
    return Boolean(entry);
  }

  private settleClosed(state: SessionState, closed: PendingQuestion[]): void {
    for (const entry of closed) {
      this.disarm(state, entry);
      state.answering.delete(entry.question.id);
    }
  }

  private disarm(state: SessionState, entry: PendingQuestion): void {
    state.timers.get(entry.question.id)?.();
    state.timers.delete(entry.question.id);
  }

  /** Pending questions already folded, oldest first; none for a session not
   * loaded yet. */
  pending(sessionId: string): PendingQuestion[] {
    return [...(this.sessions.get(sessionId)?.pending.values() ?? [])];
  }

  /** Whether a question is pending in a session whose state is loaded. */
  isPending(sessionId: string, questionId: string): boolean {
    return this.sessions.get(sessionId)?.pending.has(questionId) ?? false;
  }

  /**
   * The questions open in one Conversation, folding the session only when it
   * hasn't been yet (one archived at boot, say). Cheap for an idle session.
   */
  async pendingIn(
    sessionId: string,
    conversationId: string,
  ): Promise<PendingQuestion[]> {
    const loaded = this.sessions.has(sessionId);
    if (!loaded && this.idle.has(sessionId)) return [];
    const pending = loaded
      ? this.pending(sessionId)
      : await this.listPending(sessionId);
    return pending.filter((entry) => entry.conversationId === conversationId);
  }

  /** Pending questions, oldest first, folding the transcript if needed. */
  async listPending(sessionId: string): Promise<PendingQuestion[]> {
    const state = await this.stateFor(sessionId);
    const pending = [...state.pending.values()];
    this.evictIfIdle(sessionId, state);
    return pending;
  }

  awaiting(sessionId: string): AwaitingInput | undefined {
    const pending = this.pending(sessionId);
    if (pending.length === 0) return undefined;
    const since = pending
      .map((entry) => entry.askedAt)
      .sort((a, b) => a.localeCompare(b))[0];
    return { count: pending.length, since };
  }

  /** Sessions with at least one pending question. */
  awaitingSessions(): string[] {
    return [...this.sessions]
      .filter(([, state]) => state.pending.size > 0)
      .map(([sessionId]) => sessionId);
  }

  /**
   * Posts a question set into Prime's Conversation. A retry with the same
   * `idempotencyKey` returns the question still pending under it.
   */
  async ask(input: AskInput): Promise<AskOutcome> {
    const state = await this.liveState(input.sessionId);
    const reused = reusable(state, input.idempotencyKey);
    if (reused) return { ok: true, ...reused, reused: true };
    const error = askError(state, input.questions);
    if (error) return { ok: false, error };

    const question = this.build(input);
    if (input.idempotencyKey) {
      state.keys.set(input.idempotencyKey, question.id);
    }
    state.asking += 1;
    try {
      const { message } = await this.requirePoster()(
        await this.questionPost(input.sessionId, question),
      );
      return { ok: true, question, messageId: message.id, reused: false };
    } finally {
      state.asking -= 1;
    }
  }

  private async questionPost(
    sessionId: string,
    question: ChatQuestion,
  ): Promise<PostInput> {
    const { orchestratorId, homeConversationId } = await orchestratorIdentity(
      this.store,
      sessionId,
    );
    return {
      sessionId,
      conversationId: homeConversationId,
      author: PI_AGENT,
      content: questionFallbackText(question),
      question,
      correlationId: question.id,
      runId: this.runs?.current(sessionId, orchestratorId)?.id,
      provokes: false,
    };
  }

  private build(input: AskInput): ChatQuestion {
    const ttl = clampTtl(input.expiresInSeconds);
    return {
      id: `q-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      questions: input.questions.map((item) => ({
        ...item,
        multiSelect: item.multiSelect || undefined,
      })),
      peopleOnly: input.peopleOnly || undefined,
      expiresAt: new Date(this.clock.now() + ttl).toISOString(),
      idempotencyKey: input.idempotencyKey,
    };
  }

  /**
   * Closes a pending question as `cancelled`, with Prime's optional reason
   * (for example, that a person answered it in chat). A question that already
   * closed is left alone, and one a person is answering right now is refused,
   * so the answer and the cancel can't both land.
   */
  async cancel(
    sessionId: string,
    questionId: string,
    note?: string,
  ): Promise<CancelOutcome> {
    const state = await this.liveState(sessionId);
    const entry = state.pending.get(questionId);
    if (!entry) return "closed";
    if (state.answering.has(questionId)) return "answering";
    const closed: ChatQuestionClosed = { reason: "cancelled" };
    if (note) closed.note = note;
    await this.close(sessionId, entry, closed);
    return "cancelled";
  }

  /**
   * Checks an answer against a pending question and claims the question for
   * it, so a concurrent answer is refused rather than posted twice. The claim
   * ends when the answer is posted, or with {@link releaseAnswer} if it isn't.
   */
  async claimAnswer(
    sessionId: string,
    questionId: string,
    answer: ChatAnswer,
  ): Promise<AnswerCheck> {
    const state = await this.liveState(sessionId);
    const pending = state.pending.get(questionId);
    if (!pending) {
      return { ok: false, error: "That question is no longer pending." };
    }
    if (state.answering.has(questionId)) {
      return { ok: false, error: "That question is already being answered." };
    }
    const error = answerError(pending.question, answer);
    if (error) return { ok: false, error };
    state.answering.add(questionId);
    return {
      ok: true,
      pending,
      content: answerText(pending.question, answer),
    };
  }

  /** Drops a claim whose answer was never posted. */
  releaseAnswer(sessionId: string, questionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.answering.delete(questionId);
    this.evictIfIdle(sessionId, state);
  }

  private arm(
    sessionId: string,
    state: SessionState,
    entry: PendingQuestion,
  ): void {
    const id = entry.question.id;
    state.timers.get(id)?.();
    const cancel = this.clock.schedule(
      Date.parse(entry.question.expiresAt),
      () => {
        state.timers.delete(id);
        if (state.pending.has(id)) this.expire(sessionId, entry);
      },
    );
    state.timers.set(id, cancel);
  }

  private expire(sessionId: string, entry: PendingQuestion): void {
    this.close(sessionId, entry, { reason: "expired" }).catch(
      (err: unknown) => {
        console.error("[questions] failed to post an expiry notice:", err);
      },
    );
  }

  private async close(
    sessionId: string,
    entry: PendingQuestion,
    closed: ChatQuestionClosed,
  ): Promise<void> {
    const mentions = await this.wakeFor(sessionId, closed.reason);
    await this.requirePoster()({
      sessionId,
      conversationId: entry.conversationId,
      author: SYSTEM_AUTHOR,
      content: closedText(entry.question, closed),
      inReplyTo: entry.question.id,
      questionClosed: closed,
      mentions,
    });
  }

  /** Who a close notice addresses: Prime for an expiry, when it may be woken. */
  private async wakeFor(
    sessionId: string,
    reason: QuestionCloseReason,
  ): Promise<string[]> {
    if (reason !== "expired" || !this.wake) return [];
    try {
      if (!(await this.wake(sessionId))) return [];
    } catch (err) {
      // The notice still closes the question; Prime just isn't woken by it.
      console.error(`[questions] couldn't wake Prime in ${sessionId}:`, err);
      return [];
    }
    return [(await orchestratorIdentity(this.store, sessionId)).orchestratorId];
  }

  private requirePoster(): Post {
    if (!this.post) throw new Error("QuestionRegistry used before usePoster()");
    return this.post;
  }
}

const RECOMMENDED = /\(Recommended\)\s*$/;

/** What Prime is told to do about an expired question. Nothing is chosen for
 * it: a recommendation it made is only suggested. */
function afterExpiry(question: ChatQuestion): string {
  const recommended = question.questions.some((item) =>
    item.options.some((option) => RECOMMENDED.test(option.label)),
  );
  return recommended
    ? "Go ahead with the option you marked (Recommended), or ask again if you still need an answer."
    : "Decide without the answer, or ask again if you still need one.";
}

function closedText(question: ChatQuestion, closed: ChatQuestionClosed) {
  const headers = question.questions.map((item) => item.header).join(", ");
  const subject = `Question ${question.id} (${headers})`;
  if (closed.reason === "expired") {
    return `${subject} expired unanswered. ${afterExpiry(question)}`;
  }
  return closed.note
    ? `${subject} was cancelled by Prime: ${closed.note}`
    : `${subject} was cancelled by Prime.`;
}

function clampTtl(expiresInSeconds?: number): number {
  if (!expiresInSeconds) return DEFAULT_QUESTION_TTL_MS;
  return Math.min(
    MAX_QUESTION_TTL_MS,
    Math.max(MIN_QUESTION_TTL_MS, expiresInSeconds * 1000),
  );
}

function foldState(messages: ChatMessage[]): SessionState {
  const state: SessionState = {
    pending: new Map(),
    keys: new Map(),
    timers: new Map(),
    asking: 0,
    answering: new Set(),
  };
  for (const message of messages) {
    applyToPending(state.pending, message);
    const key = message.question?.idempotencyKey;
    if (key) state.keys.set(key, message.question!.id);
  }
  return state;
}

function reusable(
  state: SessionState,
  key?: string,
): { question: ChatQuestion; messageId: string } | undefined {
  const id = key ? state.keys.get(key) : undefined;
  const entry = id ? state.pending.get(id) : undefined;
  return entry && { question: entry.question, messageId: entry.messageId };
}

function askError(
  state: SessionState,
  items: QuestionItem[],
): string | undefined {
  if (state.pending.size + state.asking >= MAX_PENDING_QUESTIONS) {
    return (
      `There are already ${MAX_PENDING_QUESTIONS} pending questions; wait ` +
      "for answers or cancel one. People see that you can't ask more, so " +
      "say in chat which open question you need answered first."
    );
  }
  return questionsError(items);
}

/** Why a question set is malformed, or `undefined` when it is well formed. */
export function questionsError(items: QuestionItem[]): string | undefined {
  if (items.length < 1 || items.length > 4) return "Ask 1 to 4 questions.";
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) return "Question ids must be unique.";
  for (const item of items) {
    const error = itemError(item);
    if (error) return error;
  }
  return undefined;
}

function itemError(item: QuestionItem): string | undefined {
  if (!item.header.trim() || item.header.length > 12) {
    return `Header "${item.header}" must be 1 to 12 characters.`;
  }
  const count = item.options.length;
  if (count === 1 || count > 6) {
    return `"${item.header}" needs no options or 2 to 6.`;
  }
  const labels = new Set(item.options.map((option) => option.label));
  if (labels.size !== count) return `"${item.header}" repeats an option.`;
  return undefined;
}
