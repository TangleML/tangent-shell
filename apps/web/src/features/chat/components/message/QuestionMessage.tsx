import type {
  ChatMessage,
  ChatQuestion,
  QuestionItem,
  QuestionItemAnswer,
} from "@tangent/shared/contracts";
import { pendingQuestions } from "@tangent/shared/questions";
import { Button } from "@tangent/ui-primitives/button";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Textarea } from "@tangent/ui-primitives/textarea";
import { Paragraph, Text } from "@tangent/ui-primitives/typography";
import { useState } from "react";

import { useSessionChat } from "@/features/chat/hooks/useSessionChat";

import { HeaderCollapseButton } from "./HeaderCollapseButton";
import { MessageAvatar } from "./MessageAvatar";
import { MessageLayout } from "./MessageLayout";

interface QuestionMessageProps {
  sessionId: string;
  message: ChatMessage;
  question: ChatQuestion;
  onCollapse?: () => void;
}

interface ItemDraft {
  selected: string[];
  other: string;
}

type Draft = Record<string, ItemDraft>;

const EMPTY_DRAFT: ItemDraft = { selected: [], other: "" };

function closedLabel(messages: ChatMessage[], questionId: string): string {
  const closing = messages.find((m) => m.inReplyTo === questionId);
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

function QuestionItemFields({
  item,
  entry,
  disabled,
  onChange,
}: QuestionItemFieldsProps) {
  return (
    <BlockStack gap="1">
      <Text size="xs" weight="medium" tone="accent">
        {item.header}
      </Text>
      <Paragraph size="sm">{item.question}</Paragraph>
      {item.options.length > 0 ? (
        <InlineStack gap="1">
          {item.options.map((option) => {
            const pressed = entry.selected.includes(option.label);
            return (
              <Button
                key={option.label}
                size="xs"
                variant={pressed ? "default" : "outline"}
                disabled={disabled}
                title={option.description}
                aria-pressed={pressed}
                onClick={() =>
                  onChange({
                    ...entry,
                    selected: toggled(item, entry.selected, option.label),
                  })
                }
              >
                {option.label}
              </Button>
            );
          })}
        </InlineStack>
      ) : null}
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
  onCollapse,
}: QuestionMessageProps) {
  const { messagesFor, answer } = useSessionChat(sessionId);
  const messages = messagesFor(message.conversationId);
  const [draft, setDraft] = useState<Draft>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = pendingQuestions(messages).some(
    (entry) => entry.question.id === question.id,
  );
  const editable = pending && !sending;

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      await answer(question.id, {
        answers: toAnswers(question.questions, draft),
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
              {message.author.name} is asking
            </Text>
          </InlineStack>
          <HeaderCollapseButton onCollapse={onCollapse} />
        </InlineStack>
      }
    >
      <BlockStack gap="3">
        {question.questions.map((item) => (
          <QuestionItemFields
            key={item.id}
            item={item}
            entry={draft[item.id] ?? EMPTY_DRAFT}
            disabled={!editable}
            onChange={(entry) => setDraft({ ...draft, [item.id]: entry })}
          />
        ))}
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
                A person should answer this.
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
            {closedLabel(messages, question.id)}
          </Text>
        )}
      </BlockStack>
    </MessageLayout>
  );
}
