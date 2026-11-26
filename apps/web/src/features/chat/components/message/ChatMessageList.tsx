import type { AgentActivity, AgentRole } from "@tangent/shared/contracts";
import { Box } from "@tangent/ui-primitives/box";
import { BlockStack } from "@tangent/ui-primitives/layout";
import { Spinner } from "@tangent/ui-primitives/spinner";
import { Paragraph } from "@tangent/ui-primitives/typography";
import { useState } from "react";
import { Virtualizer } from "virtua";

import { useChatScroll } from "@/features/chat/hooks/useChatScroll";
import {
  isEmptyMessage,
  isThinkingOnly,
} from "@/features/chat/model/messageState";
import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";

import { AgentActivityBubble } from "./AgentActivityBubble";
import { ChatMessage } from "./ChatMessage";
import { CollapsedMessageGroup } from "./CollapsedMessageGroup";
import { JumpToBottomButton } from "./JumpToBottomButton";
import { buildSegments } from "./messageSegments";

export interface MessageLinkProps {
  getMessageLink?: (messageId: string) => string | undefined;
  targetMessageId?: string;
}

interface ChatMessageListProps extends MessageLinkProps {
  sessionId: string;
  messages: ChatMessageType[];
  currentAuthorId: string;
  /** The orchestrator's home Conversation, for the "from Prime's thread" label. */
  primaryConversationId: string;
  /** Ephemeral agent activity for this thread, or null when idle/streaming. */
  activity?: AgentActivity | null;
  /** This thread's own agent, so the activity bubble is attributed to it. */
  activityAuthorName: string;
  activityAuthorRole: AgentRole;
  /** Whether the room's history snapshot has arrived; gates loader vs empty. */
  historyLoaded: boolean;
  /** Bundle this session was created from; enables `tangent-ui:` components. */
  bundleId?: string;
  /** Forwards a prompt composed by an interactive `tangent-ui:` component. */
  onSendPrompt?: (text: string) => void;
  /** Opens a browser-viewable "page" artifact in an in-app tab. */
  onOpenArtifact?: (url: string, title: string) => void;
  /** The set of currently pinned artifact paths, for chip pin state. */
  pinnedPaths?: Set<string>;
  /** Toggles an artifact's pinned state from its chip. */
  onTogglePinArtifact?: (path: string, title: string) => void;
  /** Whether a given message id is still receiving streamed deltas. */
  isMessageStreaming: (messageId: string) => boolean;
}

// A single virtualized row: a visible message, a run of collapsed messages, or
// the trailing agent-activity bubble. Keys must be stable across renders so
// virtua's measurement cache survives streaming/collapse churn.
type Row =
  | { key: string; kind: "message"; message: ChatMessageType }
  | { key: string; kind: "collapsed"; messages: ChatMessageType[] }
  | { key: string; kind: "activity"; activity: AgentActivity };

const ACTIVITY_ROW_KEY = "__activity__";

const LINKED_MESSAGE_HIGHLIGHT = {
  "aria-current": "location",
  background: "info-subtle",
  border: "sm",
  borderColor: "info",
  borderRadius: "lg",
  padding: "sm",
} as const;

interface RowContentProps {
  row: Row;
  getMessageLink?: MessageLinkProps["getMessageLink"];
  sessionId: string;
  currentAuthorId: string;
  primaryConversationId: string;
  activityAuthorName: string;
  activityAuthorRole: AgentRole;
  bundleId?: string;
  onSendPrompt?: (text: string) => void;
  onOpenArtifact?: (url: string, title: string) => void;
  pinnedPaths?: Set<string>;
  onTogglePinArtifact?: (path: string, title: string) => void;
  isMessageStreaming: (messageId: string) => boolean;
  onCollapse: (id: string) => void;
  onExpand: (ids: string[]) => void;
}

function RowContent({
  row,
  getMessageLink,
  sessionId,
  currentAuthorId,
  primaryConversationId,
  activityAuthorName,
  activityAuthorRole,
  bundleId,
  onSendPrompt,
  onOpenArtifact,
  pinnedPaths,
  onTogglePinArtifact,
  isMessageStreaming,
  onCollapse,
  onExpand,
}: RowContentProps) {
  switch (row.kind) {
    case "message":
      return (
        <ChatMessage
          sessionId={sessionId}
          message={row.message}
          messageLink={
            row.message.streamingPlaceholder
              ? undefined
              : getMessageLink?.(row.message.id)
          }
          primaryConversationId={primaryConversationId}
          isOwn={row.message.author.id === currentAuthorId}
          bundleId={bundleId}
          onSendPrompt={onSendPrompt}
          onOpenArtifact={onOpenArtifact}
          pinnedPaths={pinnedPaths}
          onTogglePinArtifact={onTogglePinArtifact}
          isStreaming={isMessageStreaming(row.message.id)}
          onCollapse={() => onCollapse(row.message.id)}
        />
      );
    case "collapsed":
      return (
        <CollapsedMessageGroup
          count={row.messages.length}
          onExpandAll={() => onExpand(row.messages.map((m) => m.id))}
        />
      );
    case "activity":
      return (
        <AgentActivityBubble
          activity={row.activity}
          authorName={activityAuthorName}
          authorRole={activityAuthorRole}
        />
      );
  }
}

// Shown in place of the list when there are no rows: a loader until the room's
// history snapshot arrives, then the true empty-thread prompt.
function EmptyThread({ historyLoaded }: { historyLoaded: boolean }) {
  if (!historyLoaded) {
    return (
      <BlockStack fill>
        <Spinner size={20} />
      </BlockStack>
    );
  }
  return (
    <Box paddingBlock="base">
      <Paragraph size="sm" tone="subdued">
        No messages yet. Say hello to start the session.
      </Paragraph>
    </Box>
  );
}

export function ChatMessageList({
  sessionId,
  targetMessageId,
  getMessageLink,
  messages,
  currentAuthorId,
  primaryConversationId,
  activity,
  activityAuthorName,
  activityAuthorRole,
  historyLoaded,
  bundleId,
  onSendPrompt,
  onOpenArtifact,
  pinnedPaths,
  onTogglePinArtifact,
  isMessageStreaming,
}: ChatMessageListProps) {
  const [collapseOverrides, setCollapseOverrides] = useState(
    new Map<string, boolean>(),
  );
  const [previousTarget, setPreviousTarget] = useState<string>();

  const isCollapsed = (message: ChatMessageType) =>
    collapseOverrides.get(message.id) ??
    (isThinkingOnly(message) && !isMessageStreaming(message.id));

  const collapse = (id: string) =>
    setCollapseOverrides((previous) => new Map(previous).set(id, true));

  const expand = (ids: string[]) =>
    setCollapseOverrides((previous) => {
      const next = new Map(previous);
      for (const id of ids) next.set(id, false);
      return next;
    });

  if (targetMessageId !== previousTarget) {
    setPreviousTarget(targetMessageId);
    if (targetMessageId) expand([targetMessageId]);
  }

  // Empty agent messages (no content, thinking, or attachments) carry nothing to
  // show, so they are dropped entirely rather than collapsed. A still-streaming
  // message is kept since content may yet arrive.
  const visibleMessages = messages.filter(
    (message) => !isEmptyMessage(message) || isMessageStreaming(message.id),
  );

  // Flatten segments (plus the trailing activity bubble) into one stably-keyed
  // index space for virtua.
  const rows: Row[] = [];
  for (const segment of buildSegments(visibleMessages, isCollapsed)) {
    if (segment.kind === "visible") {
      rows.push({
        key: segment.message.id,
        kind: "message",
        message: segment.message,
      });
    } else {
      rows.push({
        key: segment.messages[0].id,
        kind: "collapsed",
        messages: segment.messages,
      });
    }
  }
  if (activity) {
    rows.push({ key: ACTIVITY_ROW_KEY, kind: "activity", activity });
  }
  const targetIndex =
    targetMessageId && historyLoaded
      ? rows.findIndex(
          (row) => row.kind === "message" && row.message.id === targetMessageId,
        )
      : -1;
  const {
    containerRef,
    virtualizerRef,
    onScroll,
    showJump,
    unreadCount,
    jumpToBottom,
  } = useChatScroll({
    messages: visibleMessages,
    currentAuthorId,
    rowCount: rows.length,
    targetMessageId,
    targetIndex,
  });

  // The scroll container is always rendered so its ref exists on mount and the
  // hook can attach its ResizeObserver and gesture listeners; otherwise
  // streaming growth on an initially empty thread wouldn't autoscroll once the
  // first message arrives.
  return (
    <BlockStack grow>
      <div className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col">
        <div
          ref={containerRef}
          className="reveal-scrollbar min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto px-3 [overflow-anchor:none]"
        >
          {rows.length === 0 ? (
            <EmptyThread historyLoaded={historyLoaded} />
          ) : (
            <Virtualizer ref={virtualizerRef} onScroll={onScroll}>
              {rows.map((row, index) => {
                const isLast = index === rows.length - 1;
                return (
                  <Box
                    key={row.key}
                    group
                    paddingBlockStart={index === 0 ? "base" : undefined}
                    paddingBlockEnd={isLast ? "base" : "lg"}
                  >
                    <Box
                      {...(index === targetIndex && LINKED_MESSAGE_HIGHLIGHT)}
                    >
                      <RowContent
                        row={row}
                        getMessageLink={getMessageLink}
                        sessionId={sessionId}
                        currentAuthorId={currentAuthorId}
                        primaryConversationId={primaryConversationId}
                        activityAuthorName={activityAuthorName}
                        activityAuthorRole={activityAuthorRole}
                        bundleId={bundleId}
                        onSendPrompt={onSendPrompt}
                        onOpenArtifact={onOpenArtifact}
                        pinnedPaths={pinnedPaths}
                        onTogglePinArtifact={onTogglePinArtifact}
                        isMessageStreaming={isMessageStreaming}
                        onCollapse={collapse}
                        onExpand={expand}
                      />
                    </Box>
                  </Box>
                );
              })}
            </Virtualizer>
          )}
        </div>
        {showJump ? (
          <JumpToBottomButton
            unreadCount={unreadCount}
            onClick={jumpToBottom}
          />
        ) : null}
      </div>
    </BlockStack>
  );
}
