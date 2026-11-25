import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { VirtualizerHandle } from "virtua";

import type { ChatMessage } from "@/features/chat/model/types";

// Distance (px) from the bottom within which we still consider the view
// "at the bottom". Generous enough to absorb sub-pixel rounding between
// virtua's measured sizes and the DOM after a programmatic scroll.
const PIN_THRESHOLD_PX = 32;

// After any real user scroll input we suppress auto-snapping for this long, so a
// re-measure or streaming-growth snap can't yank the view back down mid-gesture.
const SCROLL_QUIET_MS = 200;

interface UseChatScrollParams {
  messages: ChatMessage[];
  currentAuthorId: string;
  /** Number of virtualized rows (messages, collapsed groups, activity bubble). */
  rowCount: number;
  targetMessageId?: string;
  targetIndex: number;
}

interface UseChatScroll {
  containerRef: React.RefObject<HTMLDivElement | null>;
  virtualizerRef: React.RefObject<VirtualizerHandle | null>;
  /** Pass to `<Virtualizer onScroll>`. */
  onScroll: () => void;
  showJump: boolean;
  unreadCount: number;
  jumpToBottom: () => void;
}

function scrollToLastRow(handle: VirtualizerHandle | null, rowCount: number) {
  if (!handle || rowCount === 0) return;
  const lastIndex = rowCount - 1;
  const align =
    handle.getItemSize(lastIndex) > handle.viewportSize ? "start" : "end";
  handle.scrollToIndex(lastIndex, { align });
}

function atBottom(handle: VirtualizerHandle): boolean {
  return (
    handle.scrollSize - handle.scrollOffset - handle.viewportSize <=
    PIN_THRESHOLD_PX
  );
}

/**
 * Stick-to-bottom + unread-pill bookkeeping for the chat list.
 *
 * The tricky part with a virtualizer is that row sizes are measured
 * asynchronously after mount (and again as markdown/images/streaming deltas
 * render). During that settling the scroll offset briefly looks "not at the
 * bottom", so we must NOT treat every such offset as the user scrolling away —
 * otherwise we unpin, show the jump pill, and leave the list stranded.
 *
 * A link or a real scroll gesture (wheel / touch / pointer drag / keyboard)
 * takes the reader away from the bottom. Any other drift
 * away from the bottom while sticky (measurement jumps, appended rows, content
 * growth) snaps straight back down. Everything is driven through virtua's
 * handle so we never read or write the DOM scroll position directly.
 */
export function useChatScroll({
  messages,
  currentAuthorId,
  rowCount,
  targetMessageId,
  targetIndex,
}: UseChatScrollParams): UseChatScroll {
  const containerRef = useRef<HTMLDivElement>(null);
  const virtualizerRef = useRef<VirtualizerHandle>(null);

  const position = useRef<"bottom" | "reading" | "linked">("bottom");
  const scrolledToMessage = useRef<string | undefined>(undefined);
  // Set while a user scroll gesture is in flight, so `onScroll` can tell a real
  // scroll-away from virtua's own measurement/append driven offset changes.
  const userScrolledRef = useRef(false);
  // Timestamp (performance.now) of the most recent user scroll input. Auto-snap
  // backs off while this is fresh so it never fights a gesture in progress.
  const lastUserScrollAtRef = useRef(0);
  // True between pointerdown and pointerup. A scrollbar-thumb drag emits no
  // pointermove, so the timestamp above goes stale mid-gesture.
  const draggingRef = useRef(false);
  const prevLenRef = useRef(0);
  const didInitRef = useRef(false);

  const [showJump, setShowJump] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Latest row count kept in a ref so the scroll helpers stay stable and don't
  // need `rowCount` as a dependency.
  const rowCountRef = useRef(rowCount);
  useEffect(() => {
    rowCountRef.current = rowCount;
  });

  const scrollToBottom = () => {
    scrollToLastRow(virtualizerRef.current, rowCountRef.current);
  };

  // Whether drifting back to the bottom is allowed right now: we still want the
  // bottom, no gesture is in flight, and the last one has settled.
  const canAutoSnap = () =>
    position.current === "bottom" &&
    !draggingRef.current &&
    performance.now() - lastUserScrollAtRef.current > SCROLL_QUIET_MS;

  const onScroll = () => {
    const handle = virtualizerRef.current;
    if (!handle) return;

    // Estimates can briefly put a deep link at the bottom while its row is measured.
    if (position.current === "linked") {
      setShowJump(!atBottom(handle));
      return;
    }

    if (atBottom(handle)) {
      position.current = "bottom";
      // Clearing this mid-drag would make the rest of the gesture read as
      // drift, so a drag that starts near the bottom gets snapped back.
      if (!draggingRef.current) userScrolledRef.current = false;
      setShowJump(false);
      setUnreadCount(0);
      return;
    }

    if (userScrolledRef.current || draggingRef.current) {
      position.current = "reading";
      setShowJump(true);
    } else if (canAutoSnap()) {
      scrollToBottom();
    }
  };

  const jumpToBottom = () => {
    position.current = "bottom";
    userScrolledRef.current = false;
    draggingRef.current = false;
    setShowJump(false);
    setUnreadCount(0);
    scrollToBottom();
  };

  // Resolve the link once history arrives, before ordinary bottom-pinning runs.
  useLayoutEffect(() => {
    if (!targetMessageId) scrolledToMessage.current = undefined;
    const handle = virtualizerRef.current;
    if (
      handle &&
      targetMessageId &&
      targetIndex >= 0 &&
      scrolledToMessage.current !== targetMessageId
    ) {
      scrolledToMessage.current = targetMessageId;
      position.current = "linked";
      didInitRef.current = true;
      prevLenRef.current = messages.length;
      handle.scrollToIndex(targetIndex, { align: "start" });
      return;
    }
    if (didInitRef.current) return;
    didInitRef.current = true;
    prevLenRef.current = messages.length;
    if (messages.length > 0) scrollToBottom();
  }, [messages.length, targetIndex, targetMessageId]);

  // A count increase (new message, not a streaming delta) snaps own sends and
  // sticky views, else tallies the unread pill.
  useEffect(() => {
    const prevLen = prevLenRef.current;
    prevLenRef.current = messages.length;

    if (!didInitRef.current) return;
    if (messages.length <= prevLen) return;

    const lastMessage = messages[messages.length - 1];
    const isOwnSend = lastMessage?.author.id === currentAuthorId;

    if (isOwnSend || position.current === "bottom") {
      position.current = "bottom";
      userScrolledRef.current = false;
      setShowJump(false);
      setUnreadCount(0);
      scrollToBottom();
    } else {
      setUnreadCount((count) => count + (messages.length - prevLen));
      setShowJump(true);
    }
  }, [messages, currentAuthorId]);

  // Re-snap to the bottom whenever virtua's content resizes while sticky (row
  // measurement, streaming growth, a hidden tab becoming visible). We observe
  // virtua's own sized element — the scroll container's only child — and also
  // mark user scroll gestures here so `onScroll` can distinguish them.
  // Re-runs when the list flips between empty and populated so it tracks
  // whichever element virtua mounts.
  const hasRows = rowCount > 0;
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const markUserScroll = () => {
      if (position.current === "linked") position.current = "reading";
      userScrolledRef.current = true;
      lastUserScrollAtRef.current = performance.now();
    };
    const startDrag = () => {
      draggingRef.current = true;
      markUserScroll();
    };
    const endDrag = () => {
      draggingRef.current = false;
      userScrolledRef.current = false;
    };
    container.addEventListener("wheel", markUserScroll, { passive: true });
    container.addEventListener("touchmove", markUserScroll, { passive: true });
    container.addEventListener("keydown", markUserScroll);
    container.addEventListener("pointerdown", startDrag);
    // On window, not the container: a drag can end with the pointer outside it,
    // and a stuck drag flag would disable autoscroll for good.
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("touchend", endDrag);

    const inner = container.firstElementChild;
    const observer = new ResizeObserver(() => {
      const handle = virtualizerRef.current;
      if (handle && position.current === "linked") {
        setShowJump(!atBottom(handle));
      } else if (canAutoSnap()) {
        scrollToLastRow(handle, rowCountRef.current);
      }
    });
    if (inner) observer.observe(inner);

    return () => {
      container.removeEventListener("wheel", markUserScroll);
      container.removeEventListener("touchmove", markUserScroll);
      container.removeEventListener("keydown", markUserScroll);
      container.removeEventListener("pointerdown", startDrag);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("touchend", endDrag);
      observer.disconnect();
    };
  }, [hasRows]);

  return {
    containerRef,
    virtualizerRef,
    onScroll,
    showJump,
    unreadCount,
    jumpToBottom,
  };
}
