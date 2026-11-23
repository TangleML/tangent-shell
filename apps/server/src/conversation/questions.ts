import { randomUUID } from "node:crypto";

import {
  type AwaitingInput,
  type ChatAnswer,
  type ChatMessage,
  type ChatQuestion,
  PI_AGENT,
  type QuestionCloseReason,
  type QuestionItem,
  SYSTEM_AUTHOR,
} from "@tangent/shared/contracts.ts";
import {
  answerError,
  answerText,
  applyToPending,
  type PendingQuestion,
  questionFallbackText,
} from "@tangent/shared/questions.ts";

import type { RunRegistry } from "../runs/runRegistry.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import type { PostInput, PostResult } from "./conversationRouter.ts";
import { orchestratorConversationFor } from "./participantRegistry.ts";

export const MAX_PENDING_QUESTIONS = 4;
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

export type AnswerCheck =
  | { ok: true; pending: PendingQuestion; content: string }
  | { ok: false; error: string };

type Post = (input: PostInput) => Promise<PostResult>;

interface SessionState {
  pending: Map<string, PendingQuestion>;
  keys: Map<string, string>;
  timers: Map<string, () => void>;
}

/**
 * Prime's structured questions, folded from the transcript. The transcript is
 * the store: the pending set is rebuilt from a session's Messages on first
 * use, then kept current by {@link observe} on every post, so questions
 * survive a restart. Closing a question is itself a Message (an answer, or a
 * `questionClosed` system notice), so every client can run the same fold.
 */
export class QuestionRegistry {
  private readonly store: SessionStore;
  private readonly runs?: RunRegistry;
  private readonly clock: QuestionClock;
  private readonly sessions = new Map<string, SessionState>();
  private readonly loading = new Map<string, Promise<SessionState>>();
  private readonly buffered = new Map<string, ChatMessage[]>();
  private post?: Post;
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

  /** Called whenever a session's pending count may have changed. */
  useOnChange(onChange: (sessionId: string) => void): void {
    this.onChange = onChange;
  }

  /** Rebuilds every session's pending set, e.g. at boot. */
  async loadAll(): Promise<void> {
    for (const session of await this.store.listSessions()) {
      await this.load(session.id);
    }
  }

  /** The session's pending set, folding its transcript on first use. */
  async load(sessionId: string): Promise<Map<string, PendingQuestion>> {
    return (await this.stateFor(sessionId)).pending;
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
    for (const entry of [...state.pending.values()]) {
      this.arm(sessionId, state, entry);
    }
    if (state.pending.size > 0) this.onChange?.(sessionId);
    return state;
  }

  /**
   * Folds a just-posted Message in. A person's plain message that closes
   * pending questions also posts their `superseded` notices.
   */
  observe(message: ChatMessage): void {
    const state = this.sessions.get(message.sessionId);
    if (!state) return this.buffer(message);
    const closed = applyToPending(state.pending, message);
    const asked = this.armAsked(state, message);
    this.settleClosed(state, message, closed);
    if (asked || closed.length > 0) this.onChange?.(message.sessionId);
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

  private settleClosed(
    state: SessionState,
    message: ChatMessage,
    closed: PendingQuestion[],
  ): void {
    for (const entry of closed) this.disarm(state, entry);
    if (!message.inReplyTo) this.supersede(message.sessionId, closed);
  }

  private disarm(state: SessionState, entry: PendingQuestion): void {
    state.timers.get(entry.question.id)?.();
    state.timers.delete(entry.question.id);
  }

  private supersede(sessionId: string, closed: PendingQuestion[]): void {
    for (const entry of closed) {
      this.notifyClosed(sessionId, entry, "superseded");
    }
  }

  /** Pending questions, oldest first. */
  pending(sessionId: string): PendingQuestion[] {
    return [...(this.sessions.get(sessionId)?.pending.values() ?? [])];
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

  async ask(input: AskInput): Promise<AskOutcome> {
    const state = await this.stateFor(input.sessionId);
    const reused = reusable(state, input.idempotencyKey);
    if (reused) return { ok: true, ...reused, reused: true };
    const error = askError(state, input.questions);
    if (error) return { ok: false, error };

    const question = this.build(input);
    if (input.idempotencyKey) {
      state.keys.set(input.idempotencyKey, question.id);
    }
    const { message } = await this.requirePoster()({
      sessionId: input.sessionId,
      conversationId: await orchestratorConversationFor(
        this.store,
        input.sessionId,
      ),
      author: PI_AGENT,
      content: questionFallbackText(question),
      question,
      correlationId: question.id,
      runId: this.runs?.current(input.sessionId, PI_AGENT.id)?.id,
      provokes: false,
    });
    return { ok: true, question, messageId: message.id, reused: false };
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

  /** Closes a pending question as `cancelled`. Returns whether one was. */
  async cancel(sessionId: string, questionId: string): Promise<boolean> {
    const state = await this.stateFor(sessionId);
    const entry = state.pending.get(questionId);
    if (!entry) return false;
    await this.close(sessionId, entry, "cancelled");
    return true;
  }

  /** Checks an answer against a pending question and renders Prime's text. */
  async checkAnswer(
    sessionId: string,
    questionId: string,
    answer: ChatAnswer,
  ): Promise<AnswerCheck> {
    const state = await this.stateFor(sessionId);
    const pending = state.pending.get(questionId);
    if (!pending) {
      return { ok: false, error: "That question is no longer pending." };
    }
    const error = answerError(pending.question, answer);
    if (error) return { ok: false, error };
    return {
      ok: true,
      pending,
      content: answerText(pending.question, answer),
    };
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
        if (state.pending.has(id))
          this.notifyClosed(sessionId, entry, "expired");
      },
    );
    state.timers.set(id, cancel);
  }

  private notifyClosed(
    sessionId: string,
    entry: PendingQuestion,
    reason: QuestionCloseReason,
  ): void {
    this.close(sessionId, entry, reason).catch((err: unknown) => {
      console.error(`[questions] failed to post a ${reason} notice:`, err);
    });
  }

  private async close(
    sessionId: string,
    entry: PendingQuestion,
    reason: QuestionCloseReason,
  ): Promise<void> {
    await this.requirePoster()({
      sessionId,
      conversationId: entry.conversationId,
      author: SYSTEM_AUTHOR,
      content: closedText(entry.question, reason),
      inReplyTo: entry.question.id,
      questionClosed: { reason },
      provokes: false,
    });
  }

  private requirePoster(): Post {
    if (!this.post) throw new Error("QuestionRegistry used before usePoster()");
    return this.post;
  }
}

function closedText(question: ChatQuestion, reason: QuestionCloseReason) {
  const headers = question.questions.map((item) => item.header).join(", ");
  const why = {
    superseded: "a new message replaced it",
    expired: "it expired unanswered",
    cancelled: "Prime cancelled it",
  }[reason];
  return `Question ${question.id} (${headers}) closed: ${why}.`;
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
  if (state.pending.size >= MAX_PENDING_QUESTIONS) {
    return `There are already ${MAX_PENDING_QUESTIONS} pending questions; wait for answers or cancel one.`;
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
