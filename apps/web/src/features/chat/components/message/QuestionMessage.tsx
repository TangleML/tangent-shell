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
import { useState, useSyncExternalStore } from "react";

import {
  NO_MESSAGES,
  peekSessionChat,
  peekSessionChatRoom,
  subscribeToSessionChat,
} from "@/features/chat/hooks/sessionChatRoom";

import { HeaderCollapseButton } from "./HeaderCollapseButton";
import { MessageAvatar } from "./MessageAvatar";
import { MessageLayout } from "./MessageLayout";

interface QuestionMessageProps {
  sessionId: string;
  message: ChatMessage;
  question: ChatQuestion;
  onCollapse?: () => void;
}

type Draft = Record<string, { selected: string[]; other: string }>;

function useConversationMessages(
  sessionId: string,
  conversationId: string,
): ChatMessage[] {
  const snapshot = useSyncExternalStore(subscribeToSessionChat(sessionId), () =>
    peekSessionChat(sessionId),
  );
  return snapshot.messagesByConversation.get(conversationId) ?? NO_MESSAGES;
}

function closedLabel(messages: ChatMessage[], questionId: string): string {
  const closing = messages.find((m) => m.inReplyTo === questionId);
  if (closing?.answer) return `Answered by ${closing.author.name}`;
  if (closing?.questionClosed?.reason === "expired") return "Expired";
  if (closing?.questionClosed?.reason === "cancelled") return "Withdrawn";
  return "Replaced by a newer message";
}

function isComplete(items: QuestionItem[], draft: Draft): boolean {
  return items.every((item) => {
    const entry = draft[item.id];
    return Boolean(entry?.selected.length || entry?.other.trim());
  });
}

function toAnswers(items: QuestionItem[], draft: Draft): QuestionItemAnswer[] {
  return items.map((item) => {
    const entry = draft[item.id] ?? { selected: [], other: "" };
    const other = entry.other.trim();
    return {
      id: item.id,
      selected: entry.selected,
      ...(other ? { other } : {}),
    };
  });
}

interface QuestionItemFieldsProps {
  item: QuestionItem;
  entry: { selected: string[]; other: string };
  disabled: boolean;
  onChange: (entry: { selected: string[]; other: string }) => void;
}

function QuestionItemFields({
  item,
  entry,
  disabled,
  onChange,
}: QuestionItemFieldsProps) {
  const toggle = (label: string) => {
    const has = entry.selected.includes(label);
    const selected = item.multiSelect
      ? has
        ? entry.selected.filter((l) => l !== label)
        : [...entry.selected, label]
      : has
        ? []
        : [label];
    onChange({ ...entry, selected });
  };

  return (
    <BlockStack gap="1">
      <Text size="xs" weight="medium" tone="accent">
        {item.header}
      </Text>
      <Paragraph size="sm">{item.question}</Paragraph>
      {item.options.length > 0 ? (
        <InlineStack gap="1">
          {item.options.map((option) => (
            <Button
              key={option.label}
              size="xs"
              variant={
                entry.selected.includes(option.label) ? "default" : "outline"
              }
              disabled={disabled}
              title={option.description}
              aria-pressed={entry.selected.includes(option.label)}
              onClick={() => toggle(option.label)}
            >
              {option.label}
            </Button>
          ))}
        </InlineStack>
      ) : null}
      <Textarea
        rows={1}
        placeholder={
          item.options.length ? "Or answer in your own words" : "Your answer"
        }
        value={entry.other}
        disabled={disabled}
        aria-label={`${item.header}: free-text answer`}
        onChange={(e) => onChange({ ...entry, other: e.target.value })}
      />
    </BlockStack>
  );
}

/** Prime's structured question, answerable in place until it closes. */
export function QuestionMessage({
  sessionId,
  message,
  question,
  onCollapse,
}: QuestionMessageProps) {
  const messages = useConversationMessages(sessionId, message.conversationId);
  const [draft, setDraft] = useState<Draft>({});
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = pendingQuestions(messages).some(
    (entry) => entry.question.id === question.id,
  );
  const open = pending && !sent;
  const empty = { selected: [], other: "" };

  const submit = () => {
    try {
      peekSessionChatRoom(sessionId)?.answer(question.id, {
        answers: toAnswers(question.questions, draft),
      });
      setSent(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
            entry={draft[item.id] ?? empty}
            disabled={!open}
            onChange={(entry) => setDraft({ ...draft, [item.id]: entry })}
          />
        ))}
        {open ? (
          <InlineStack gap="2" blockAlign="center">
            <Button
              size="xs"
              disabled={!isComplete(question.questions, draft)}
              onClick={submit}
            >
              Send answer
            </Button>
            {error ? (
              <Text size="xs" tone="critical">
                {error}
              </Text>
            ) : null}
          </InlineStack>
        ) : (
          <Text size="xs" tone="subdued">
            {pending ? "Sending…" : closedLabel(messages, question.id)}
          </Text>
        )}
      </BlockStack>
    </MessageLayout>
  );
}
