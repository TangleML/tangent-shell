// local primitive

import { useGravatar } from "@/features/user/hooks/useGravatar";
import { userInitials } from "@/features/user/model/userDisplay";
import { cn } from "@/shared/lib/utils";

interface UserAvatarProps {
  email?: string;
  name: string;
  label?: string;
  size?: "sm" | "md";
}

export function UserAvatar({
  email,
  name,
  label = name,
  size = "md",
}: UserAvatarProps) {
  const url = useGravatar(email?.includes("@") ? email : "");
  const frame = cn(
    "shrink-0 rounded-full",
    size === "sm" ? "size-6" : "size-8",
  );
  if (!url) {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={cn(
          frame,
          "inline-flex items-center justify-center bg-secondary text-xs font-medium text-secondary-foreground",
        )}
      >
        {userInitials(name)}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={label}
      title={label}
      className={cn(frame, "object-cover")}
    />
  );
}
