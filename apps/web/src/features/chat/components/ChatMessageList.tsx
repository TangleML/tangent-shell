import type { AgentActivity } from "@tangent/shared/contracts";
import { useEffect, useRef, useState } from "react";

import { isThinkingOnly } from "@/features/chat/model/messageState";
import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";
import { Box } from "@/shared/ui/box";
import { BlockStack } from "@/shared/ui/layout";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";
import { Paragraph } from "@/shared/ui/typography";

import { AgentActivityBubble } from "./AgentActivityBubble";
import { ChatMessage, CollapsedMessageGroup } from "./ChatMessage";

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

// A visible message renders normally; a run of one or more consecutive
// collapsed messages is grouped so it can render as a single hidden affordance.
type RenderSegment =
  | { kind: "visible"; message: ChatMessageType }
  | { kind: "collapsed"; messages: ChatMessageType[] };

/** Groups consecutive collapsed messages into runs, preserving order. */
function buildSegments(
  messages: ChatMessageType[],
  isCollapsed: (message: ChatMessageType) => boolean,
): RenderSegment[] {
  const segments: RenderSegment[] = [];
  let run: ChatMessageType[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    segments.push({ kind: "collapsed", messages: run });
    run = [];
  };

  for (const message of messages) {
    if (isCollapsed(message)) {
      run.push(message);
      continue;
    }
    flushRun();
    segments.push({ kind: "visible", message });
  }
  flushRun();

  return segments;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
  // Whether the view is stuck to the bottom. Tracked in a ref (not state) so
  // updating it from scroll/resize handlers never triggers a re-render.
  const pinnedRef = useRef(true);

  // Follow streaming growth (content + thinking) and thinking expand/collapse:
  // a ResizeObserver on the content wrapper reacts to any height change and
  // keeps us at the bottom while pinned. A scroll listener tracks pinned state.
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const onScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      pinnedRef.current = distanceFromBottom <= PIN_THRESHOLD_PX;
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

  // A brand-new message always jumps to the bottom and re-pins, so a user's own
  // send (or a fresh agent reply) is immediately in view.
  useEffect(() => {
    pinnedRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  // The scroll container is always rendered (even when empty) so the refs exist
  // on mount and the setup effect above can attach its observers; otherwise the
  // ResizeObserver would never wire up and streaming growth wouldn't autoscroll.
  return (
    <BlockStack grow>
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
    </BlockStack>
  );
}
