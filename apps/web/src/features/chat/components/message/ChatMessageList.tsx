import type { AgentActivity } from "@tangent/shared/contracts";
import { useEffect, useRef, useState } from "react";

import { isThinkingOnly } from "@/features/chat/model/messageState";
import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";
import { Box } from "@/shared/ui/box";
import { BlockStack } from "@/shared/ui/layout";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";
import { Paragraph } from "@/shared/ui/typography";

import { AgentActivityBubble } from "./AgentActivityBubble";
import { ChatMessage } from "./ChatMessage";
import { CollapsedMessageGroup } from "./CollapsedMessageGroup";
import { JumpToBottomButton } from "./JumpToBottomButton";
import { buildSegments } from "./messageSegments";

interface ChatMessageListProps {
  sessionId: string;
  messages: ChatMessageType[];
  currentAuthorId: string;
  /** Ephemeral agent activity for this thread, or null when idle/streaming. */
  activity?: AgentActivity | null;
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

// Distance (px) from the bottom within which we still consider the user
// "pinned": once they scroll further up, streaming autoscroll pauses.
const PIN_THRESHOLD_PX = 32;

export function ChatMessageList({
  sessionId,
  messages,
  currentAuthorId,
  activity,
  bundleId,
  onSendPrompt,
  onOpenArtifact,
  pinnedPaths,
  onTogglePinArtifact,
  isMessageStreaming,
}: ChatMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const prevLenRef = useRef(0);

  const [showJump, setShowJump] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Collapse state is ephemeral per view (not URL or server). Thinking-only
  // messages collapse by default once they finish streaming; `expandedIds`
  // records the user overriding that default, while `collapsedIds` records the
  // user collapsing a message that would otherwise be visible. Consecutive
  // collapsed ids are grouped at render time into a "<n> messages hidden" row.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const isCollapsed = (message: ChatMessageType) => {
    if (expandedIds.has(message.id)) return false;
    if (collapsedIds.has(message.id)) return true;
    return isThinkingOnly(message) && !isMessageStreaming(message.id);
  };

  const collapse = (id: string) => {
    setCollapsedIds((prev) => new Set(prev).add(id));
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const expand = (ids: string[]) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  };
  const scrollToBottom = () => {
    pinnedRef.current = true;
    setShowJump(false);
    setUnreadCount(0);
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  // Keep pinned views at the bottom as content grows, and track pinned state.
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const onScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const atBottom = distanceFromBottom <= PIN_THRESHOLD_PX;
      pinnedRef.current = atBottom;
      setShowJump(!atBottom);
      if (atBottom) setUnreadCount(0);
    };
    container.addEventListener("scroll", onScroll, { passive: true });

    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) {
        bottomRef.current?.scrollIntoView({ block: "end" });
      }
    });
    observer.observe(content);

    return () => {
      container.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  // New message (count grew, not a streaming delta): own sends always snap to
  // the bottom; agent messages only when pinned, else tally for the pill.
  useEffect(() => {
    const prevLen = prevLenRef.current;
    prevLenRef.current = messages.length;
    if (messages.length <= prevLen) return;

    const lastMessage = messages[messages.length - 1];
    const isOwnSend = lastMessage?.author.id === currentAuthorId;

    if (isOwnSend || pinnedRef.current) {
      scrollToBottom();
    } else {
      setUnreadCount((count) => count + (messages.length - prevLen));
      setShowJump(true);
    }
  }, [messages, currentAuthorId]);

  // The scroll container is always rendered (even when empty) so the refs exist
  // on mount and the setup effect above can attach its observers; otherwise the
  // ResizeObserver would never wire up and streaming growth wouldn't autoscroll.
  return (
    <BlockStack grow>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ScrollRegion ref={containerRef} axis="y">
          <Box padding="base">
            <BlockStack fill ref={contentRef} gap="4">
              {messages.length === 0 ? (
                <Paragraph size="sm" tone="subdued">
                  No messages yet. Say hello to start the session.
                </Paragraph>
              ) : (
                buildSegments(messages, isCollapsed).map((segment) => {
                  if (segment.kind === "visible") {
                    const msg = segment.message;
                    return (
                      <ChatMessage
                        key={msg.id}
                        sessionId={sessionId}
                        message={msg}
                        isOwn={msg.author.id === currentAuthorId}
                        bundleId={bundleId}
                        onSendPrompt={onSendPrompt}
                        onOpenArtifact={onOpenArtifact}
                        pinnedPaths={pinnedPaths}
                        onTogglePinArtifact={onTogglePinArtifact}
                        isStreaming={isMessageStreaming(msg.id)}
                        onCollapse={() => collapse(msg.id)}
                      />
                    );
                  }
                  const [first] = segment.messages;

                  return (
                    <CollapsedMessageGroup
                      key={first.id}
                      count={segment.messages.length}
                      onExpandAll={() =>
                        expand(segment.messages.map((m) => m.id))
                      }
                    />
                  );
                })
              )}
              {activity ? <AgentActivityBubble activity={activity} /> : null}
              <div ref={bottomRef} />
            </BlockStack>
          </Box>
        </ScrollRegion>
        {showJump ? (
          <JumpToBottomButton
            unreadCount={unreadCount}
            onClick={scrollToBottom}
          />
        ) : null}
      </div>
    </BlockStack>
  );
}
