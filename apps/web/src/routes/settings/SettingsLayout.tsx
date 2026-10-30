import { Button } from "@tangent/ui-primitives/button";
import { Icon, type IconName } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Heading, Text } from "@tangent/ui-primitives/typography";
import { Outlet, useRouter } from "@tanstack/react-router";

import { useMyPermissions } from "@/features/user/hooks/useMyPermissions";
import { SideNavLink } from "@/shared/ui/patterns/side-nav";
import { WorkArea } from "@/shared/ui/patterns/work-area";

import { SettingsHeader, SettingsNav } from "./settings-frame";

interface SettingsItem {
  to: "/settings/global-memory" | "/settings/bundle-editors";
  label: string;
  icon: IconName;
  adminOnly: boolean;
}

const SETTINGS_ITEMS: SettingsItem[] = [
  {
    to: "/settings/global-memory",
    label: "Global memory",
    icon: "Brain",
    adminOnly: false,
  },
  {
    to: "/settings/bundle-editors",
    label: "Bundle editors",
    icon: "Users",
    adminOnly: true,
  },
];

export function SettingsLayout() {
  const router = useRouter();
  const { isAdmin } = useMyPermissions();
  const items = SETTINGS_ITEMS.filter((item) => isAdmin || !item.adminOnly);

  return (
    <WorkArea>
      <BlockStack gap="6" align="stretch">
        <SettingsHeader title={<Heading level={1}>Settings</Heading>}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.history.back()}
          >
            <Icon name="ArrowLeft" />
            Back
          </Button>
        </SettingsHeader>

        <InlineStack gap="8" blockAlign="start" wrap="nowrap">
          <SettingsNav>
            {items.map((item) => (
              <SideNavLink key={item.to} to={item.to} replace>
                <Icon name={item.icon} size="sm" />
                <Text size="sm">{item.label}</Text>
              </SideNavLink>
            ))}
          </SettingsNav>

          <BlockStack grow align="stretch">
            <Outlet />
          </BlockStack>
        </InlineStack>
      </BlockStack>
    </WorkArea>
  );
}
