// local primitive

import type { ReactNode } from "react";

import { useGravatar } from "@/features/user/hooks/useGravatar";

interface UserAvatarProps {
  email: string;
  fallback: ReactNode;
}

/**
 * UserAvatar — resolves a Gravatar image for `email` and renders it as a
 * circular avatar. While the lookup is in flight or when no Gravatar exists,
 * it renders `fallback` (typically an initials badge). Styles a raw `<img>`
 * (the sanctioned escape hatch), so it is exempt from
 * `tangle-ui/no-classname-on-primitives`.
 */
export function UserAvatar({ email, fallback }: UserAvatarProps) {
  const url = useGravatar(email);
  if (!url) return <>{fallback}</>;
  return (
    <img
      src={url}
      alt=""
      className="size-8 shrink-0 rounded-full object-cover"
    />
  );
}
