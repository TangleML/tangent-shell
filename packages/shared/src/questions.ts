import type {
  ChatAnswer,
  ChatMessage,
  ChatQuestion,
  QuestionItem,
} from "./contracts.ts";

/** A question still waiting for an answer, with the Message that asked it. */
export interface PendingQuestion {
  question: ChatQuestion;
  messageId: string;
  conversationId: string;
  askedAt: string;
}

/**
 * Applies one Message to a pending-question set, in transcript order: a
 * question opens; an answer or close notice naming it closes it; a person's
 * plain message closes every question pending in its Conversation.
 */
export function applyToPending(
  pending: Map<string, PendingQuestion>,
  message: ChatMessage,
): PendingQuestion[] {
  if (message.question) {
    pending.set(message.question.id, {
      question: message.question,
      messageId: message.id,
      conversationId: message.conversationId,
      askedAt: message.createdAt,
    });
    return [];
  }
  if (message.inReplyTo && (message.answer || message.questionClosed)) {
    const closed = pending.get(message.inReplyTo);
    pending.delete(message.inReplyTo);
    return closed ? [closed] : [];
  }
  if (!supersedes(message)) return [];
  const superseded = [...pending.values()].filter(
    (entry) => entry.conversationId === message.conversationId,
  );
  for (const entry of superseded) pending.delete(entry.question.id);
  return superseded;
}

function supersedes(message: ChatMessage): boolean {
  return (
    message.author.kind === "human" &&
    !message.command &&
    message.content.trim().length > 0
  );
}

/** The questions still pending after `messages`, oldest first. Expired ones
 * are dropped when `now` is given. */
export function pendingQuestions(
  messages: readonly ChatMessage[],
  now?: number,
): PendingQuestion[] {
  const pending = new Map<string, PendingQuestion>();
  for (const message of messages) applyToPending(pending, message);
  return [...pending.values()].filter(
    (entry) => now === undefined || Date.parse(entry.question.expiresAt) > now,
  );
}

function itemText(item: QuestionItem, index: number): string {
  const lines = [`${index + 1}. **${item.header}**: ${item.question}`];
  item.options.forEach((option, i) => {
    const description = option.description ? ` — ${option.description}` : "";
    lines.push(
      `   ${String.fromCharCode(97 + i)}. ${option.label}${description}`,
    );
  });
  return lines.join("\n");
}

/** The Markdown fallback a question Message carries in `content`. */
export function questionFallbackText(question: ChatQuestion): string {
  const items = question.questions.map(itemText).join("\n");
  return `**Prime is asking:**\n\n${items}\n\n_Reply with your answer, or pick options in a client that shows questions._`;
}

/**
 * The text Prime reads for an answer: each question with what was picked and
 * any free text, so the answer stands on its own in Prime's context.
 */
export function answerText(question: ChatQuestion, answer: ChatAnswer): string {
  const lines = question.questions.map((item) => {
    const given = answer.answers.find((entry) => entry.id === item.id);
    const parts = [...(given?.selected ?? [])];
    if (given?.other?.trim()) parts.push(`"${given.other.trim()}"`);
    const value = parts.length ? parts.join(", ") : "(no answer)";
    return `- ${item.header} (${item.question}): ${value}`;
  });
  return `Answer to your question ${question.id}:\n${lines.join("\n")}`;
}

/** Why an answer can't be accepted for `question`, or `undefined` if it can. */
export function answerError(
  question: ChatQuestion,
  answer: ChatAnswer,
): string | undefined {
  if (!Array.isArray(answer?.answers) || answer.answers.length === 0) {
    return "The answer has no entries.";
  }
  for (const entry of answer.answers) {
    const item = question.questions.find(
      (candidate) => candidate.id === entry.id,
    );
    if (!item) return `Question ${question.id} has no item "${entry.id}".`;
    const selected = Array.isArray(entry.selected) ? entry.selected : [];
    const labels = new Set(item.options.map((option) => option.label));
    const unknown = selected.find((label) => !labels.has(label));
    if (unknown) return `"${unknown}" isn't an option of "${item.header}".`;
    if (!item.multiSelect && selected.length > 1) {
      return `"${item.header}" takes one option.`;
    }
    if (selected.length === 0 && !entry.other?.trim()) {
      return `"${item.header}" needs an option or free text.`;
    }
  }
  return undefined;
}
