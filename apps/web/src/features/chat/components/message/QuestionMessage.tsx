import type {
  ChatAnswer,
  ChatMessage,
  ChatQuestion,
  QuestionItem,
  QuestionItemAnswer,
} from "@tangent/shared/contracts";
import {
  MAX_PENDING_QUESTIONS,
  pendingQuestions,
} from "@tangent/shared/questions";
import { Button } from "@tangent/ui-primitives/button";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Textarea } from "@tangent/ui-primitives/textarea";
import { Paragraph, Text } from "@tangent/ui-primitives/typography";
import { type ReactNode, useState } from "react";

import { useSessionChat } from "@/features/chat/hooks/useSessionChat";

import { MessageAvatar } from "./MessageAvatar";
import { MessageLayout } from "./MessageLayout";

interface QuestionMessageProps {
  sessionId: string;
  message: ChatMessage;
  question: ChatQuestion;
  /** Copy, link and collapse controls shown in the header. */
  actions?: ReactNode;
}

interface ItemDraft {
  selected: string[];
  other: string;
}

type Draft = Record<string, ItemDraft>;

const EMPTY_DRAFT: ItemDraft = { selected: [], other: "" };

function closingMessage(
  messages: ChatMessage[],
  questionId: string,
): ChatMessage | undefined {
  return messages.find(
    (m) => m.inReplyTo === questionId && (m.answer || m.questionClosed),
  );
}

function closedLabel(closing: ChatMessage | undefined): string {
  const answeredBy = closing?.answer?.answeredBy;
  if (answeredBy?.kind === "relayed") {
    return `A person's answer, relayed by ${answeredBy.by}`;
  }
  if (closing?.answer) return `Answered by ${closing.author.name}`;
  const closed = closing?.questionClosed;
  if (closed?.reason === "expired") return "Expired unanswered";
  if (closed?.note) return `Closed by Prime: ${closed.note}`;
  return "Closed by Prime";
}

function isComplete(items: QuestionItem[], draft: Draft): boolean {
  return items.every((item) => {
    const entry = draft[item.id];
    return Boolean(entry?.selected.length || entry?.other.trim());
  });
}

function toAnswers(items: QuestionItem[], draft: Draft): QuestionItemAnswer[] {
  return items.map((item) => {
    const entry = draft[item.id] ?? EMPTY_DRAFT;
    const other = entry.other.trim();
    return {
      id: item.id,
      selected: entry.selected,
      ...(other ? { other } : {}),
    };
  });
}

function toggled(item: QuestionItem, selected: string[], label: string) {
  if (selected.includes(label)) return selected.filter((l) => l !== label);
  return item.multiSelect ? [...selected, label] : [label];
}

interface QuestionItemFieldsProps {
  item: QuestionItem;
  entry: ItemDraft;
  disabled: boolean;
  onChange: (entry: ItemDraft) => void;
}

function OptionButton({
  label,
  pressed,
  disabled,
  onToggle,
}: {
  label: string;
  pressed: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      size="xs"
      variant={pressed ? "default" : "outline"}
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onToggle}
    >
      {label}
    </Button>
  );
}

/**
 * An item's options as toggle buttons. When any option has a description they
 * stack, each with its description beside it, so people read the trade-off
 * before picking rather than only on hover.
 */
function ItemOptions({
  item,
  entry,
  disabled,
  onChange,
}: QuestionItemFieldsProps) {
  const toggle = (label: string) =>
    onChange({ ...entry, selected: toggled(item, entry.selected, label) });
  const described = item.options.some((option) => option.description);

  if (!described) {
    return (
      <InlineStack gap="1">
        {item.options.map((option) => (
          <OptionButton
            key={option.label}
            label={option.label}
            pressed={entry.selected.includes(option.label)}
            disabled={disabled}
            onToggle={() => toggle(option.label)}
          />
        ))}
      </InlineStack>
    );
  }

  return (
    <BlockStack gap="1">
      {item.options.map((option) => (
        <InlineStack
          key={option.label}
          gap="2"
          blockAlign="center"
          wrap="nowrap"
        >
          <OptionButton
            label={option.label}
            pressed={entry.selected.includes(option.label)}
            disabled={disabled}
            onToggle={() => toggle(option.label)}
          />
          {option.description ? (
            <Text size="xs" tone="subdued">
              {option.description}
            </Text>
          ) : null}
        </InlineStack>
      ))}
    </BlockStack>
  );
}

function ItemHeading({ item }: { item: QuestionItem }) {
  return (
    <>
      <Text size="xs" weight="medium" tone="accent">
        {item.header}
        {item.multiSelect && item.options.length > 0 ? (
          <Text size="xs" tone="subdued">
            {" "}
            · pick any
          </Text>
        ) : null}
      </Text>
      <Paragraph size="sm">{item.question}</Paragraph>
    </>
  );
}

function QuestionItemFields(props: QuestionItemFieldsProps) {
  const { item, entry, disabled, onChange } = props;
  return (
    <BlockStack gap="1">
      <ItemHeading item={item} />
      {item.options.length > 0 ? <ItemOptions {...props} /> : null}
      <Textarea
        rows={1}
        placeholder={
          item.options.length ? "Or answer in your own words" : "Your answer"
        }
        value={entry.other}
        disabled={disabled}
        aria-label={`${item.header}: answer in your own words`}
        onChange={(e) => onChange({ ...entry, other: e.target.value })}
      />
    </BlockStack>
  );
}

/** What was answered for one item, as picked labels then quoted free text. */
function answeredValue(item: QuestionItem, answer?: ChatAnswer): string {
  const given = answer?.answers.find((entry) => entry.id === item.id);
  const parts = [...(given?.selected ?? [])];
  const other = given?.other?.trim();
  if (other) parts.push(`\u201c${other}\u201d`);
  return parts.join(", ");
}

/** A closed item: the question and, when it was answered, what was picked. */
function ClosedItem({
  item,
  answer,
}: {
  item: QuestionItem;
  answer?: ChatAnswer;
}) {
  const value = answeredValue(item, answer);
  return (
    <BlockStack gap="1">
      <ItemHeading item={item} />
      {value ? (
        <Text size="sm" weight="medium">
          {value}
        </Text>
      ) : null}
    </BlockStack>
  );
}

/**
 * Prime's structured question, answerable in place until it closes: options
 * as buttons (several when multi-select) plus free text for every item.
 * Whether it is still open is folded from the Conversation's transcript, so a
 * reload or another person's answer closes it everywhere.
 */
export function QuestionMessage({
  sessionId,
  message,
  question,
  actions,
}: QuestionMessageProps) {
  const { messagesFor, answer } = useSessionChat(sessionId);
  const messages = messagesFor(message.conversationId);
  const [draft, setDraft] = useState<Draft>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = pendingQuestions(messages);
  const pending = open.some((entry) => entry.question.id === question.id);
  // At the cap Prime's next ask_question is refused; say so on the newest card
  // so people know answering one unblocks it.
  const atCap =
    open.length >= MAX_PENDING_QUESTIONS &&
    open[open.length - 1]?.question.id === question.id;
  const editable = pending && !sending;
  const closing = pending ? undefined : closingMessage(messages, question.id);

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      // Someone answering in this UI is a person, which a peopleOnly
      // question needs stated.
      await answer(question.id, {
        answers: toAnswers(question.questions, draft),
        answeredBy: { kind: "person" },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <MessageLayout
      variant="agent"
      avatar={
        <MessageAvatar
          kind={message.author.kind}
          name={message.author.name}
          agentRole={message.author.agentRole}
        />
      }
      header={
        <InlineStack align="start" blockAlign="center" gap="2" wrap="nowrap">
          <InlineStack gap="1" blockAlign="center">
            <Icon name="MessageCircleQuestionMark" size="xs" tone="accent" />
            <Text size="xs" weight="medium" tone="accent">
              {pending
                ? `${message.author.name} is asking`
                : `${message.author.name} asked`}
            </Text>
          </InlineStack>
          {actions}
        </InlineStack>
      }
    >
      <BlockStack gap="3">
        {question.questions.map((item) =>
          pending ? (
            <QuestionItemFields
              key={item.id}
              item={item}
              entry={draft[item.id] ?? EMPTY_DRAFT}
              disabled={!editable}
              onChange={(entry) => setDraft({ ...draft, [item.id]: entry })}
            />
          ) : (
            <ClosedItem key={item.id} item={item} answer={closing?.answer} />
          ),
        )}
        {atCap ? (
          <Text size="xs" tone="warning">
            {`${message.author.name} has ${open.length} open questions, the most it can ask at once. Answer one so it can ask more.`}
          </Text>
        ) : null}
        {pending ? (
          <InlineStack gap="2" blockAlign="center">
            <Button
              size="xs"
              disabled={!editable || !isComplete(question.questions, draft)}
              onClick={() => void submit()}
            >
              {sending ? "Sending…" : "Send answer"}
            </Button>
            {question.peopleOnly ? (
              <Text size="xs" tone="subdued">
                Only a person can answer this.
              </Text>
            ) : null}
            {error ? (
              <Text size="xs" tone="critical">
                {error}
              </Text>
            ) : null}
          </InlineStack>
        ) : (
          <Text size="xs" tone="subdued">
            {closedLabel(closing)}
          </Text>
        )}
      </BlockStack>
    </MessageLayout>
  );
}
