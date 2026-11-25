import type {
  ChatAnswer,
  ChatAnswerAck,
  ChatAuthor,
  ChatMessagePayload,
  Session,
} from "@tangent/shared/contracts.ts";
import type { Socket } from "socket.io";

import {
  parseAnswer,
  type QuestionRegistry,
} from "../conversation/questions.ts";
import { PRIME_AGENT_ID } from "../pi/piAgentManager.ts";
import type { ChatHandlerDeps } from "./chat.ts";
import { ensureSessionAgents } from "./sessionRoster.ts";

/** The socket.io acknowledgement a client may pass with a `chat:message`. */
export type AnswerAck = (ack: ChatAnswerAck) => void;

/** Whether a `chat:message` payload is an answer to one of Prime's questions. */
export function isAnswerPayload(payload: ChatMessagePayload): boolean {
  return Boolean(payload?.inReplyTo && payload.answer);
}

/**
 * Tells the client how its answer went: through its ack when it passed one,
 * else by the socket's `error` event on a refusal.
 */
function reply(socket: Socket, ack: AnswerAck | undefined, error?: string) {
  if (ack) return ack(error ? { ok: false, error } : { ok: true });
  if (error) socket.emit("error", { message: error });
}

/**
 * Posts a person's answer into the question's Conversation. The payload is
 * untrusted, so it is parsed against the contract and checked against the
 * pending question before anything is written; Prime reads the server-rendered
 * text, so what it is told matches what was validated. The question is claimed
 * while the answer is posted, so two people answering at once can't both land.
 */
export async function handleChatAnswer(
  socket: Socket,
  deps: ChatHandlerDeps,
  author: ChatAuthor,
  session: Session,
  payload: ChatMessagePayload,
  ack?: AnswerAck,
): Promise<void> {
  const { questions } = deps;
  const parsed = parsePayload(payload);
  if (!questions || !parsed) {
    return reply(socket, ack, "That answer isn't valid.");
  }
  const { questionId, answer } = parsed;
  const check = await questions.claimAnswer(session.id, questionId, answer);
  if (!check.ok) return reply(socket, ack, check.error);
  try {
    await postClaimed(deps, author, session, {
      conversationId: check.pending.conversationId,
      content: check.content,
      questionId,
      answer,
      delivery: payload.delivery,
    });
  } catch (error) {
    questions.releaseAnswer(session.id, questionId);
    reply(socket, ack, failureReason(questions, session.id, questionId));
    throw error;
  }
  reply(socket, ack);
}

/**
 * What to tell the person when posting their answer threw. A failure after the
 * answer was written (waking Prime, say) still closed the question, so their
 * answer did land and nothing is reported.
 */
function failureReason(
  questions: QuestionRegistry,
  sessionId: string,
  questionId: string,
): string | undefined {
  if (!questions.isPending(sessionId, questionId)) return undefined;
  return "The answer couldn't be posted.";
}

function parsePayload(
  payload: ChatMessagePayload,
): { questionId: string; answer: ChatAnswer } | undefined {
  const answer = parseAnswer(payload.answer);
  if (!answer || typeof payload.inReplyTo !== "string") return undefined;
  return { questionId: payload.inReplyTo, answer };
}

async function postClaimed(
  deps: ChatHandlerDeps,
  author: ChatAuthor,
  session: Session,
  post: {
    conversationId: string;
    content: string;
    questionId: string;
    answer: ChatAnswer;
    delivery: ChatMessagePayload["delivery"];
  },
): Promise<void> {
  const { store, pi, connectors, conversations } = deps;
  // An answer is what Prime is waiting on, so a cold session is woken for it.
  if (!pi.hasAgent(session.id, PRIME_AGENT_ID)) {
    await ensureSessionAgents(store, pi, connectors, session);
  }
  await conversations.post({
    sessionId: session.id,
    conversationId: post.conversationId,
    author,
    content: post.content,
    inReplyTo: post.questionId,
    answer: post.answer,
    delivery: post.delivery ?? "auto",
  });
}
