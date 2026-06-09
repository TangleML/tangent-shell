import { Link } from "@tanstack/react-router";

import { TopNav, TopNavLink } from "@/shared/ui/patterns/top-nav";
import { Text } from "@/shared/ui/typography";

import { ThemeMenu } from "./ThemeMenu";

/**
 * AppTopNav — the application's persistent top navigation bar.
 *
 * Brand on the left, primary navigation links beside it. Rendered once by the
 * app layout route so it stays fixed across every page.
 */
export function AppTopNav() {
  return (
    <TopNav
      brand={
        <Link to="/sessions">
          <Text size="lg" weight="bold">
            Tangent Shell
          </Text>
        </Link>
      }
      links={
        <>
          <TopNavLink to="/sessions">Sessions</TopNavLink>
          <TopNavLink to="/agent-bundles">Agent bundles</TopNavLink>
        </>
      }
      actions={<ThemeMenu />}
    />
  );
}
