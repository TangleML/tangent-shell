import type { AgentActivity } from "@tangent/shared/contracts";
import { useEffect, useRef, useState } from "react";
import { Virtualizer, type VirtualizerHandle } from "virtua";

import { isThinkingOnly } from "@/features/chat/model/messageState";
import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";
import { Box } from "@/shared/ui/box";
import { BlockStack } from "@/shared/ui/layout";
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

// A single virtualized row: a visible message, a run of collapsed messages, or
// the trailing agent-activity bubble. Keys must be stable across renders so
// virtua's measurement cache survives streaming/collapse churn.
type Row =
  | { key: string; kind: "message"; message: ChatMessageType }
  | { key: string; kind: "collapsed"; messages: ChatMessageType[] }
  | { key: string; kind: "activity"; activity: AgentActivity };

const ACTIVITY_ROW_KEY = "__activity__";

// Distance (px) from the bottom within which we still consider the user
// "pinned": once they scroll further up, streaming autoscroll pauses.
const PIN_THRESHOLD_PX = 32;

// Instant stick-to-bottom: clamp scrollTop to the (virtua-sized) content
// height. Robust during streaming because it doesn't depend on the last item
// being fully measured yet — the ResizeObserver re-pins once it is.
function stickToBottom(container: HTMLDivElement | null) {
  if (container) container.scrollTop = container.scrollHeight;
}

// Smooth scroll to the last virtualized row, used for explicit jumps and new
// message snaps so the motion matches the previous non-virtualized list.
function smoothScrollToBottom(
  handle: VirtualizerHandle | null,
  rowCount: number,
) {
  if (handle && rowCount > 0) {
    handle.scrollToIndex(rowCount - 1, { align: "end", smooth: true });
  }
}

interface RowContentProps {
  row: Row;
  sessionId: string;
  currentAuthorId: string;
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
  sessionId,
  currentAuthorId,
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
      return <AgentActivityBubble activity={row.activity} />;
  }
}

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const virtualizerRef = useRef<VirtualizerHandle>(null);
  const pinnedRef = useRef(true);
  const prevLenRef = useRef(0);
  const rowCountRef = useRef(0);
  const didInitRef = useRef(false);

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

  // Flatten segments (plus the trailing activity bubble) into one stably-keyed
  // index space for virtua.
  const rows: Row[] = [];
  for (const segment of buildSegments(messages, isCollapsed)) {
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
  const hasRows = rows.length > 0;

  // Latest row count for effects/handlers that snap to the bottom, kept in a
  // ref so the message effect below doesn't need `rows` as a dependency.
  useEffect(() => {
    rowCountRef.current = rows.length;
  });

  // Explicit jump (pill click): mark pinned and smooth-scroll to the last row.
  const jumpToBottom = () => {
    pinnedRef.current = true;
    setShowJump(false);
    setUnreadCount(0);
    smoothScrollToBottom(virtualizerRef.current, rows.length);
  };

  // Track pinned state from the scroll position.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const atBottom = distanceFromBottom <= PIN_THRESHOLD_PX;
      pinnedRef.current = atBottom;
      setShowJump(!atBottom);
      if (atBottom) setUnreadCount(0);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // Keep pinned views at the bottom as content grows. virtua re-measures items
  // internally (without re-rendering this component), so we observe its own
  // sized container element — the scroll container's only child — and re-pin on
  // every size change. Re-runs when the list flips between empty and populated
  // so it tracks whichever element virtua mounts.
  useEffect(() => {
    const container = containerRef.current;
    const inner = container?.firstElementChild;
    if (!container || !inner) return;

    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) stickToBottom(container);
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [hasRows]);

  // First load snaps to the bottom instantly; afterwards a count increase
  // (new message, not a streaming delta) snaps own sends and pinned agent
  // messages, else tallies the unread pill.
  useEffect(() => {
    const prevLen = prevLenRef.current;
    prevLenRef.current = messages.length;

    if (!didInitRef.current) {
      didInitRef.current = true;
      if (messages.length > 0) stickToBottom(containerRef.current);
      return;
    }

    if (messages.length <= prevLen) return;

    const lastMessage = messages[messages.length - 1];
    const isOwnSend = lastMessage?.author.id === currentAuthorId;

    if (isOwnSend || pinnedRef.current) {
      pinnedRef.current = true;
      setShowJump(false);
      setUnreadCount(0);
      smoothScrollToBottom(virtualizerRef.current, rowCountRef.current);
    } else {
      setUnreadCount((count) => count + (messages.length - prevLen));
      setShowJump(true);
    }
  }, [messages, currentAuthorId]);

  // The scroll container (and the persistent content wrapper) is always
  // rendered so its refs exist on mount and the setup effect above can attach
  // its scroll listener and ResizeObserver; otherwise streaming growth on an
  // initially empty thread wouldn't autoscroll once the first message arrives.
  return (
    <BlockStack grow>
      <div className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col">
        <div
          ref={containerRef}
          className="min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto px-3 [overflow-anchor:none]"
        >
          {rows.length === 0 ? (
            <Box paddingBlock="base">
              <Paragraph size="sm" tone="subdued">
                No messages yet. Say hello to start the session.
              </Paragraph>
            </Box>
          ) : (
            <Virtualizer ref={virtualizerRef}>
              {rows.map((row, index) => {
                const isLast = index === rows.length - 1;
                return (
                  <Box
                    key={row.key}
                    paddingBlockStart={index === 0 ? "base" : undefined}
                    paddingBlockEnd={isLast ? "base" : "lg"}
                  >
                    <RowContent
                      row={row}
                      sessionId={sessionId}
                      currentAuthorId={currentAuthorId}
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
