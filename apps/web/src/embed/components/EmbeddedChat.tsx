import {
  type ParticipantWithMemberships,
  PI_AGENT,
} from "@tangent/shared/contracts";
import { Box } from "@tangent/ui-primitives/box";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { useEffect } from "react";

import { AgentModelPicker } from "@/features/chat/components/composer/AgentModelPicker";
import { BundlePanelLauncher } from "@/features/chat/components/composer/BundlePanelLauncher";
import { ChatInput } from "@/features/chat/components/composer/ChatInput";
import { ChatMessageList } from "@/features/chat/components/message/ChatMessageList";
import { SubagentTabView } from "@/features/chat/components/tabs/SubagentTabView";
import { useSessionChat } from "@/features/chat/hooks/useSessionChat";
import { useSessionParticipants } from "@/features/chat/hooks/useSessionParticipants";
import { buildMentionCandidates } from "@/features/chat/model/mentions";
import { useSession } from "@/features/sessions/hooks/useSession";
import { EmptyState } from "@/shared/ui/patterns/empty-state";

import type { TangentRuntime } from "../types";

interface EmbeddedChatProps {
  sessionId: string;
  runtime: TangentRuntime;
  /** When set, render that agent's thread instead of Prime. */
  agentId?: string;
  /** The host opens the resource however it wants (a tab, a drawer, ...). */
  onOpenArtifact?: (url: string, title: string) => void;
  /** Fired when the user submits a prompt, so the host can react. */
  onSendPrompt?: (content: string) => void;
}

function isPrimeAgent(agentId: string | undefined): boolean {
  return !agentId || agentId === PI_AGENT.id;
}

/**
 * The embedded chat surface: Prime's (or a chosen sub-agent's) message list
 * plus the composer. No dock windows, tab strip, or session card — the host
 * owns all chrome and placement.
 */
export function EmbeddedChat({
  sessionId,
  runtime,
  agentId,
  onOpenArtifact,
  onSendPrompt,
}: EmbeddedChatProps) {
  const chat = useSessionChat(sessionId);
  const { data: session } = useSession(sessionId);
  const { data: participants = [] } = useSessionParticipants(sessionId);
  const bundleId = session?.config?.id;
  const { historyLoaded, primaryConversationId, rosterReady } = chat;
  const targetingPrime = isPrimeAgent(agentId);

  useEffect(() => {
    if (!targetingPrime) return;
    if (!rosterReady) return;
    const pending = runtime.takePendingPrompt(sessionId);
    if (!pending) return;
    if (pending.model || pending.thinkingDepth) {
      chat.setAgentModel(PI_AGENT.id, {
        model: pending.model,
        thinkingDepth: pending.thinkingDepth,
      });
    }
    if (pending.prompt || pending.attachments?.length) {
      chat.send(pending.prompt ?? "", {
        conversationId: primaryConversationId,
        delivery: pending.delivery,
        attachments: pending.attachments,
      });
    }
    // chat callbacks are recreated each render; keying on the roster gate is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterReady, sessionId, targetingPrime]);

  const togglePinArtifact = (path: string, title: string) => {
    if (chat.pinnedPaths.has(path)) {
      chat.unpinArtifact(path);
    } else {
      chat.pinArtifact(path, title);
    }
  };

  if (!targetingPrime && agentId) {
    return (
      <SubagentChat
        sessionId={sessionId}
        agentId={agentId}
        bundleId={bundleId}
        chat={chat}
        rosterReady={rosterReady}
        participants={participants}
        onOpenArtifact={onOpenArtifact}
        onSendPrompt={onSendPrompt}
        onTogglePinArtifact={togglePinArtifact}
      />
    );
  }

  const primeModel = chat.getAgentModel(PI_AGENT.id);

  // Who Prime's composer can @mention: the sub-agent roster and invited humans.
  const mentionCandidates = buildMentionCandidates(
    chat.subagents,
    participants,
  );

  return (
    <BlockStack fill grow align="stretch" inlineAlign="start">
      <ChatMessageList
        sessionId={sessionId}
        messages={chat.messagesFor(primaryConversationId)}
        currentAuthorId={chat.currentAuthorId}
        primaryConversationId={primaryConversationId}
        activity={chat.getActivity(primaryConversationId)}
        activityAuthorName={PI_AGENT.name}
        activityAuthorRole="prime"
        historyLoaded={historyLoaded}
        bundleId={bundleId}
        onSendPrompt={chat.send}
        onOpenArtifact={onOpenArtifact}
        pinnedPaths={chat.pinnedPaths}
        onTogglePinArtifact={togglePinArtifact}
        isMessageStreaming={chat.isMessageStreaming}
      />
      <Box paddingInline="base" paddingBlock="sm">
        <InlineStack align="end">
          <AgentModelPicker
            model={primeModel?.model}
            thinkingDepth={primeModel?.thinkingDepth}
            onChange={(selection) => chat.setAgentModel(PI_AGENT.id, selection)}
            disabled={!chat.connected || !rosterReady}
          />
        </InlineStack>
      </Box>
      {bundleId ? (
        <BundlePanelLauncher
          bundleId={bundleId}
          onSendPrompt={(text) =>
            chat.send(text, { conversationId: primaryConversationId })
          }
        />
      ) : null}
      <ChatInput
        key={`${sessionId}:${PI_AGENT.id}`}
        sessionId={sessionId}
        agentId={PI_AGENT.id}
        disabled={!chat.connected || !rosterReady}
        agentBusy={chat.agentBusy}
        mentionCandidates={mentionCandidates}
        onAbort={() => chat.abort(primaryConversationId)}
        onSubmit={(content, { delivery, attachments }) => {
          chat.send(content, {
            conversationId: primaryConversationId,
            delivery,
            attachments,
          });
          onSendPrompt?.(content);
        }}
      />
    </BlockStack>
  );
}

interface SubagentChatProps {
  sessionId: string;
  agentId: string;
  bundleId?: string;
  chat: ReturnType<typeof useSessionChat>;
  rosterReady: boolean;
  participants: ParticipantWithMemberships[];
  onOpenArtifact?: (url: string, title: string) => void;
  onSendPrompt?: (content: string) => void;
  onTogglePinArtifact: (path: string, title: string) => void;
}

function SubagentChat({
  sessionId,
  agentId,
  bundleId,
  chat,
  rosterReady,
  participants,
  onOpenArtifact,
  onSendPrompt,
  onTogglePinArtifact,
}: SubagentChatProps) {
  if (!rosterReady) {
    return <BlockStack fill grow align="stretch" />;
  }

  const subagent = chat.subagents.find((s) => s.id === agentId);
  if (!subagent) {
    return (
      <Box padding="base">
        <EmptyState
          size="sm"
          title="Agent unavailable"
          description="This agent is no longer in the session."
        />
      </Box>
    );
  }

  const conversationId = chat.conversationForAgent(agentId);
  const model = chat.getAgentModel(agentId);
  const mentionCandidates = buildMentionCandidates(
    chat.subagents,
    participants,
  );

  return (
    <SubagentTabView
      sessionId={sessionId}
      agentId={agentId}
      primaryConversationId={chat.primaryConversationId}
      name={subagent.name}
      messages={chat.messagesFor(conversationId)}
      currentAuthorId={chat.currentAuthorId}
      bundleId={bundleId}
      historyLoaded={chat.historyLoaded}
      activity={chat.getActivity(conversationId)}
      status={subagent.status}
      busy={chat.isConversationBusy(conversationId)}
      disabled={!chat.connected}
      isMessageStreaming={chat.isMessageStreaming}
      onAbort={() => chat.abort(conversationId)}
      onRemove={() => chat.dismissSubagent(agentId)}
      onSubmit={(content, { delivery, attachments }) => {
        chat.send(content, { conversationId, delivery, attachments });
        onSendPrompt?.(content);
      }}
      model={model?.model}
      thinkingDepth={model?.thinkingDepth}
      onSetModel={(selection) => chat.setAgentModel(agentId, selection)}
      onOpenArtifact={onOpenArtifact}
      pinnedPaths={chat.pinnedPaths}
      onTogglePinArtifact={onTogglePinArtifact}
      mentionCandidates={mentionCandidates}
    />
  );
}
