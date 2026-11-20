// local primitive

import { useGravatar } from "@/features/user/hooks/useGravatar";
import { userInitials } from "@/features/user/model/userDisplay";
import { cn } from "@/shared/lib/utils";

interface UserAvatarProps {
  email?: string;
  name: string;
  title?: string;
  size?: "sm" | "md";
  muted?: boolean;
}

export function UserAvatar({
  email,
  name,
  title,
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
        title={title}
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
      title={title}
      className={cn(frame, "object-cover", muted && "grayscale")}
    />
  );
}
