import { cva } from "class-variance-authority";
import type { ReactNode } from "react";

import type { AgentRole } from "@/features/chat/model/types";
import { cn } from "@/shared/lib/utils";
import { Box } from "@/shared/ui/box";
import { Icon } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";

import { MessageBubble, type MessageBubbleVariant } from "./MessageBubble";

// Role-keyed avatar styling. The `agent`/`subagent` roles reuse the same
// `message-surface` tokens as the agent `MessageBubble`, so a theme can
// fine-tune those colors in one place and the badge follows the bubble.
const messageAvatarVariants = cva(
  "flex size-6 shrink-0 items-center justify-center rounded-full",
  {
    variants: {
      role: {
        human: "bg-secondary text-secondary-foreground",
        agent:
          "bg-message-surface text-message-surface-foreground border border-message-surface-border",
        subagent:
          "bg-message-surface text-message-surface-foreground border border-message-surface-border",
      },
    },
    defaultVariants: {
      role: "human",
    },
  },
);

type MessageAvatarRole = "human" | "agent" | "subagent";

function avatarRole(
  kind: "human" | "agent",
  agentRole?: AgentRole,
): MessageAvatarRole {
  if (kind !== "agent") return "human";
  return agentRole === "subagent" ? "subagent" : "agent";
}

const AVATAR_ICONS: Record<MessageAvatarRole, "User" | "Crown" | "Bot"> = {
  human: "User",
  agent: "Crown",
  subagent: "Bot",
};

interface MessageAvatarProps {
  kind: "human" | "agent";
  name: string;
  agentRole?: AgentRole;
}

/**
 * MessageAvatar — small circular badge conveying the message sender's kind
 * (human, prime agent, sub-agent). Styles a raw `<div>` (the sanctioned escape
 * hatch, like `StatusDot`/`UserAvatar`), so it is exempt from
 * tangle-ui/no-classname-on-primitives.
 */
export function MessageAvatar({ kind, name, agentRole }: MessageAvatarProps) {
  const role = avatarRole(kind, agentRole);
  return (
    <div
      title={name}
      aria-label={name}
      className={cn(messageAvatarVariants({ role }))}
    >
      <Icon name={AVATAR_ICONS[role]} size="xs" />
    </div>
  );
}

interface MessageLayoutProps {
  /** Sender badge rendered to the left of the bubble (e.g. `MessageAvatar`). */
  avatar: ReactNode;
  /** Row above the bubble (author/label + actions); omit for headerless rows. */
  header?: ReactNode;
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
        <BlockStack gap="1" align="stretch">
          {header}
          <MessageBubble variant={variant} selectable={selectable}>
            {children}
          </MessageBubble>
        </BlockStack>
      </InlineStack>
    </Box>
  );
}
