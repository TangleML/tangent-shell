// local primitive

import { BlockStack } from "@tangent/ui-primitives/layout";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@tangent/ui-primitives/tooltip";
import { Text } from "@tangent/ui-primitives/typography";

import { useGravatar } from "@/features/user/hooks/useGravatar";
import { userInitials } from "@/features/user/model/userDisplay";
import { cn } from "@/shared/lib/utils";

interface UserAvatarProps {
  email?: string;
  name: string;
  size?: "sm" | "md";
  muted?: boolean;
}

export function UserAvatar({
  email,
  name,
  size = "md",
  muted = false,
}: UserAvatarProps) {
  const url = useGravatar(email?.includes("@") ? email : "");
  const frame = cn(
    "shrink-0 rounded-full bg-secondary",
    size === "sm" ? "size-6" : "size-8",
  );
  if (!url) {
    return (
      <span
        role="img"
        aria-label={name}
        className={cn(
          frame,
          "inline-flex items-center justify-center text-xs font-medium",
          muted ? "text-muted-foreground" : "text-secondary-foreground",
        )}
      >
        {userInitials(name)}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={name}
      className={cn(frame, "object-cover", muted && "grayscale")}
    />
  );
}

/** Identity shared by a person's header and chat portraits. */
export function UserAvatarWithTooltip({
  email,
  name,
  displayName = name,
  label = displayName,
  className,
  ...avatar
}: UserAvatarProps & {
  displayName?: string;
  label?: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        className={cn(
          "flex shrink-0 cursor-help rounded-full focus-visible:outline-2 focus-visible:outline-ring",
          className,
        )}
      >
        <UserAvatar email={email} name={name} {...avatar} />
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        <BlockStack gap="0.5">
          <Text size="sm" weight="semibold" tone="on-primary">
            {displayName}
          </Text>
          {email?.includes("@") && email !== displayName && (
            <Text size="xs" tone="on-primary">
              {email}
            </Text>
          )}
        </BlockStack>
      </TooltipContent>
    </Tooltip>
  );
}
