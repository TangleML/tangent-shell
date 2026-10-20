import { Icon } from "@tangent/ui-primitives/icon";
import { cva } from "class-variance-authority";

import type { AgentRole } from "@/features/chat/model/types";
import { UserAvatar } from "@/features/user/components/UserAvatar";
import { cn } from "@/shared/lib/utils";

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
  /** The human author's email, used to resolve a Gravatar image. */
  email?: string;
}

/**
 * MessageAvatar — small circular badge conveying the message sender's kind
 * (human, prime agent, sub-agent). Delegates to {@link UserAvatar}: human
 * authors show their Gravatar, and everyone else (or a human without one) falls
 * back to the role icon badge.
 *
 * Styles a raw `<div>` (the sanctioned escape hatch, like `StatusDot`), so it is
 * exempt from `tangle-ui/no-classname-on-primitives`.
 */
export function MessageAvatar({
  kind,
  name,
  agentRole,
  email,
}: MessageAvatarProps) {
  const role = avatarRole(kind, agentRole);
  const badge = (
    <div
      title={name}
      aria-label={name}
      className={cn(messageAvatarVariants({ role }))}
    >
      <Icon name={AVATAR_ICONS[role]} size="xs" />
    </div>
  );

  if (role !== "human" || !email?.trim().length) return badge;

  return (
    <UserAvatar email={email ?? ""} name={name} size="sm" fallback={badge} />
  );
}
