import type {
  ChatAnswer,
  ChatMessage,
  ChatQuestion,
  PendingQuestion,
  QuestionItem,
  QuestionItemAnswer,
} from "./contracts.ts";

/**
 * Applies one Message to a pending-question set, in transcript order: a
 * question opens, and an answer or close notice naming it closes it. Any other
 * Message, a person's plain reply included, leaves questions pending; Prime
 * closes one it considers answered with `cancel_question`. Returns the
 * question this Message closed, if any.
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
  if (!message.inReplyTo || !(message.answer || message.questionClosed)) {
    return [];
  }
  const closed = pending.get(message.inReplyTo);
  pending.delete(message.inReplyTo);
  return closed ? [closed] : [];
}

/**
 * The questions still pending after `messages`, oldest first. The server posts
 * an `expired` notice when a question times out; pass `now` to also drop ones
 * past `expiresAt` whose notice hasn't arrived yet.
 */
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

/** The Markdown a question Message carries in `content`, for clients that
 * don't render structured questions. */
export function questionFallbackText(question: ChatQuestion): string {
  const items = question.questions.map(itemText).join("\n");
  const who = question.peopleOnly ? " A person should answer." : "";
  return `**Prime is asking:**\n\n${items}\n\n_Reply with your answer.${who}_`;
}

/**
 * The text Prime reads for an answer: each question with what was picked and
 * any free text, so the answer stands on its own in Prime's context.
 */
export function answerText(question: ChatQuestion, answer: ChatAnswer): string {
  const lines = question.questions.map((item) => {
    const given = answer.answers.find((entry) => entry.id === item.id);
    const parts = [...(given?.selected ?? [])];
    const other = given?.other?.trim();
    if (other) parts.push(`"${other}"`);
    const value = parts.length ? parts.join(", ") : "(no answer)";
    return `- ${item.header} (${item.question}): ${value}`;
  });
  return `Answer to your question ${question.id}:\n${lines.join("\n")}`;
}

/**
 * The note Prime is handed with a Message delivered while questions are still
 * open in its Conversation, so it can close one the Message answered.
 */
export function pendingNoteText(pending: readonly PendingQuestion[]): string {
  const listed = pending
    .map(({ question }) => {
      const headers = question.questions.map((item) => item.header).join(", ");
      return `${question.id} (${headers})`;
    })
    .join("; ");
  return (
    `[Still waiting on your question${pending.length === 1 ? "" : "s"}: ${listed}. ` +
    "If this message answers one, close it with cancel_question.]"
  );
}

function entryError(
  item: QuestionItem,
  entry: QuestionItemAnswer,
): string | undefined {
  const labels = new Set(item.options.map((option) => option.label));
  const unknown = entry.selected.find((label) => !labels.has(label));
  if (unknown) return `"${unknown}" isn't an option of "${item.header}".`;
  const picked = entry.selected.length;
  if (picked > 1 && !item.multiSelect) {
    return `"${item.header}" takes one option.`;
  }
  const hasText = Boolean(entry.other?.trim());
  if (picked === 0 && !hasText) {
    return `"${item.header}" needs an option or free text.`;
  }
  return undefined;
}

/**
 * Why an answer can't be accepted for `question`, or `undefined` if it can.
 * Each entry must name a distinct item and pick its real options (one, unless
 * the item is multi-select) and/or give free text. Items left out read as
 * unanswered.
 */
export function answerError(
  question: ChatQuestion,
  answer: ChatAnswer,
): string | undefined {
  if (answer.answers.length === 0) return "The answer has no entries.";
  const seen = new Set<string>();
  for (const entry of answer.answers) {
    const item = question.questions.find(
      (candidate) => candidate.id === entry.id,
    );
    if (!item) return `Question ${question.id} has no item "${entry.id}".`;
    if (seen.has(entry.id)) return `"${item.header}" is answered twice.`;
    seen.add(entry.id);
    const error = entryError(item, entry);
    if (error) return error;
  }
  return undefined;
}
