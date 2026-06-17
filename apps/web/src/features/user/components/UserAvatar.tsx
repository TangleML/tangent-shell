import type { UserIdentity } from "@tangent/shared/contracts";

import { userInitials } from "@/features/user/model/userDisplay";

interface UserAvatarProps {
  user: UserIdentity;
}

/**
 * UserAvatar — circular initials badge for the current user.
 *
 * Styles a raw `<div>` (the sanctioned escape hatch, like `StatusDot`), so it
 * is exempt from `tangle-ui/no-classname-on-primitives`.
 */
export function UserAvatar({ user }: UserAvatarProps) {
  const fullName = `${user.first_name} ${user.last_name}`.trim();
  return (
    <div
      title={fullName}
      aria-label={fullName}
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground"
    >
      {userInitials(user)}
    </div>
  );
}
