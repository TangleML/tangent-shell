import { InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";
import { Link } from "@tanstack/react-router";

import { UserAvatar } from "@/features/user/components/UserAvatar";
import { useCurrentUser } from "@/features/user/hooks/useCurrentUser";
import { TopNav, TopNavLink } from "@/shared/ui/patterns/top-nav";

import { TangleLogo } from "./TangleLogo";
import { ThemeMenu } from "./ThemeMenu";

/**
 * AppTopNav — the application's persistent top navigation bar.
 *
 * Brand on the left, primary navigation links beside it. Rendered once by the
 * app layout route so it stays fixed across every page.
 */
export function AppTopNav() {
  const user = useCurrentUser();
  return (
    <TopNav
      brand={
        <Link to="/sessions">
          <InlineStack gap="2" blockAlign="center">
            <TangleLogo />
            <Text size="lg" weight="bold">
              Tangent Shell
            </Text>
          </InlineStack>
        </Link>
      }
      links={
        <>
          <TopNavLink to="/sessions">Sessions</TopNavLink>
          <TopNavLink to="/agent-bundles">Agent bundles</TopNavLink>
          <TopNavLink to="/global-memory">Global memory</TopNavLink>
        </>
      }
      actions={
        <>
          <ThemeMenu />
          <UserAvatar user={user} />
        </>
      }
    />
  );
}
