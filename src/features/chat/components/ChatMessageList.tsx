import type { AgentActivity } from "@shared/contracts";
import { useEffect, useRef } from "react";

import type { ChatMessage as ChatMessageType } from "@/features/chat/model/types";
import { Box } from "@/shared/ui/box";
import { BlockStack } from "@/shared/ui/layout";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";
import { Paragraph } from "@/shared/ui/typography";

import { AgentActivityBubble } from "./AgentActivityBubble";
import { ChatMessage } from "./ChatMessage";

interface ChatMessageListProps {
  sessionId: string;
  messages: ChatMessageType[];
  currentAuthorId: string;
  /** Ephemeral agent activity for this thread, or null when idle/streaming. */
  activity?: AgentActivity | null;
}

// Distance (px) from the bottom within which we still consider the user
// "pinned": once they scroll further up, streaming autoscroll pauses.
const PIN_THRESHOLD_PX = 32;

export function ChatMessageList({
  sessionId,
  messages,
  currentAuthorId,
  activity,
}: ChatMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
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
    <BlockStack fill>
      <ScrollRegion ref={containerRef} axis="y">
        <Box padding="base">
          <BlockStack fill ref={contentRef} gap="2">
            {messages.length === 0 ? (
              <Paragraph size="sm" tone="subdued">
                No messages yet. Say hello to start the session.
              </Paragraph>
            ) : (
              messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  sessionId={sessionId}
                  message={msg}
                  isOwn={msg.author.id === currentAuthorId}
                />
              ))
            )}
            {activity ? <AgentActivityBubble activity={activity} /> : null}
            <div ref={bottomRef} />
          </BlockStack>
        </Box>
      </ScrollRegion>
    </BlockStack>
  );
}
