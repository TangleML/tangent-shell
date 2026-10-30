// local primitive

import { BlockStack } from "@tangent/ui-primitives/layout";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@tangent/ui-primitives/tooltip";
import { Text } from "@tangent/ui-primitives/typography";

import { UserAvatar } from "@/features/user/components/UserAvatar";
import { UserInitialsBadge } from "@/features/user/components/UserInitialsBadge";
import { useCurrentUser } from "@/features/user/hooks/useCurrentUser";
import { useMyPermissions } from "@/features/user/hooks/useMyPermissions";
import { userFullName, userRoleLabel } from "@/features/user/model/userDisplay";

/**
 * The current user's avatar for the top nav: a Gravatar (falling back to an
 * initials badge) with a tooltip showing their full name and role. The role
 * line is withheld while permissions load so the tooltip never shows a wrong
 * "Member" before the real role arrives.
 */
export function CurrentUserAvatar() {
  const user = useCurrentUser();
  const permissions = useMyPermissions();
  const fullName = userFullName(user);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={fullName}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <UserAvatar
            email={user.email}
            fallback={<UserInitialsBadge user={user} />}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        <BlockStack gap="0.5">
          <Text size="sm" weight="semibold" tone="inverted">
            {fullName}
          </Text>
          {permissions.isLoading ? null : (
            <Text size="xs" tone="inverted">
              {userRoleLabel(permissions)}
            </Text>
          )}
        </BlockStack>
      </TooltipContent>
    </Tooltip>
  );
}
