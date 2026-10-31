// local primitive

import type { UserIdentity } from "@tangent/shared/contracts";

import { userInitials } from "@/features/user/model/userDisplay";

interface UserInitialsBadgeProps {
  user: UserIdentity;
}

/**
 * Circular initials badge. Styles a raw `<div>` (the sanctioned escape hatch,
 * like `StatusDot`), so it is exempt from `tangle-ui/no-classname-on-primitives`.
 * `aria-hidden` because the accessible name lives on the enclosing trigger.
 */
export function UserInitialsBadge({ user }: UserInitialsBadgeProps) {
  return (
    <div
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground"
    >
      {userInitials(user)}
    </div>
  );
}
