import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Heading, Paragraph } from "@tangent/ui-primitives/typography";
import { useState } from "react";

import { useExtensionMarketplaces } from "@/features/global-extensions/hooks/useExtensionMarketplaces";
import { useGlobalExtensions } from "@/features/global-extensions/hooks/useGlobalExtensions";
import { useMyPermissions } from "@/features/user/hooks/useMyPermissions";
import { Section } from "@/shared/ui/patterns/section";

import { ExtensionList } from "./ExtensionList";
import { InstallExtensionButton } from "./InstallExtensionButton";
import { InstallWizard } from "./InstallWizard";

function GlobalExtensionsContent({ canManage }: { canManage: boolean }) {
  const { data, isLoading, error } = useGlobalExtensions();
  const marketplaces = useExtensionMarketplaces();
  const [activeId, setActiveId] = useState<string | null>(null);

  if (error) {
    return (
      <Paragraph size="sm" tone="critical">
        Failed to load extensions: {error.message}
      </Paragraph>
    );
  }
  if (isLoading || !data) {
    return (
      <Paragraph size="sm" tone="subdued">
        Loading extensions...
      </Paragraph>
    );
  }

  const activeMarketplace =
    marketplaces.data?.find((m) => m.id === activeId) ?? null;

  return (
    <>
      {activeMarketplace ? (
        <InstallWizard
          key={activeMarketplace.id}
          marketplace={activeMarketplace}
          installed={data}
          onClose={() => setActiveId(null)}
        />
      ) : canManage && marketplaces.data ? (
        <InlineStack align="end">
          <InstallExtensionButton
            marketplaces={marketplaces.data}
            onStart={setActiveId}
          />
        </InlineStack>
      ) : null}

      <Section title="Installed">
        <ExtensionList extensions={data} canManage={canManage} />
      </Section>
    </>
  );
}

export function GlobalExtensionsSettings() {
  const { isAdmin, isLoading } = useMyPermissions();

  return (
    <BlockStack gap="6" align="stretch">
      <BlockStack gap="1">
        <Heading level={2}>Extensions</Heading>
        <Paragraph size="sm" tone="subdued">
          {isAdmin || isLoading
            ? "Global packages applied to sessions that opt in. Changes take effect on each agent's next spawn."
            : "Global packages applied to sessions that opt in. Only admins can install or remove them."}
        </Paragraph>
      </BlockStack>
      <GlobalExtensionsContent canManage={isAdmin} />
    </BlockStack>
  );
}
