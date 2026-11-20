// local primitive

import { Icon } from "@tangent/ui-primitives/icon";

import type { ChatAuthor } from "@/features/chat/model/types";
import { UserAvatar } from "@/features/user/components/UserAvatar";

interface MessageAvatarProps {
  author: Omit<ChatAuthor, "id"> & { id?: string };
}

export function MessageAvatar({ author }: MessageAvatarProps) {
  if (author.kind === "human") {
    return <UserAvatar email={author.id} name={author.name} size="sm" />;
  }
  return (
    <div
      title={author.name}
      aria-label={author.name}
      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-message-surface-border bg-message-surface text-message-surface-foreground"
    >
      <Icon
        name={author.agentRole === "subagent" ? "Bot" : "Crown"}
        size="xs"
      />
    </div>
  );
}
