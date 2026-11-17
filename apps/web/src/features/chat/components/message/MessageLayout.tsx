import { Box } from "@tangent/ui-primitives/box";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import type { ReactNode } from "react";

import { MessageBubble, type MessageBubbleVariant } from "./MessageBubble";

interface MessageLayoutProps {
  /** Sender badge rendered to the left of the bubble (e.g. `MessageAvatar`). */
  avatar?: ReactNode;
  /** Row above the bubble (author/label + actions); omit for headerless rows. */
  header?: ReactNode;
  /** `own` also puts the message on the right, as chat apps do. */
  variant: MessageBubbleVariant;
  /** When false, native text selection inside the bubble is disabled. */
  selectable?: boolean;
  children: ReactNode;
}

/**
 * Shared message frame: an avatar aligned to the bottom of a bubble, with an
 * optional header row above it. `group` lets hover-revealed header actions light
 * up on hover of the whole message.
 */
export function MessageLayout({
  avatar,
  header,
  variant,
  selectable,
  children,
}: MessageLayoutProps) {
  return (
    <Box group inlineSize="full">
      <InlineStack gap="2" blockAlign="end" wrap="nowrap">
        {avatar}
        <BlockStack gap="1" align={variant === "own" ? "end" : "stretch"} grow>
          {header}
          <MessageBubble variant={variant} selectable={selectable}>
            {children}
          </MessageBubble>
        </BlockStack>
      </InlineStack>
    </Box>
  );
}
