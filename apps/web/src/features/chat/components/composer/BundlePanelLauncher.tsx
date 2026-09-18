import { Box } from "@tangent/ui-primitives/box";
import { Button } from "@tangent/ui-primitives/button";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";
import { useState } from "react";

import { useAgentBundle } from "@/features/agent-bundles/hooks/useAgentBundle";
import { BundleUiHost } from "@/features/bundle-ui/BundleUiHost";
import { apiUrl } from "@/shared/lib/basePath";
import { HostOwnedSurface } from "@/shared/lib/HostOwnedSurface";
import { useHostExtensions } from "@/shared/lib/hostSlots";
import { IconButton } from "@/shared/ui/patterns/icon-button";

interface BundlePanelLauncherProps {
  /** The bundle whose `kind: "panel"` components are offered to the user. */
  bundleId: string;
  /** Composes the panel's prompt and sends it to Prime. */
  onSendPrompt: (text: string) => void;
}

/**
 * Lists a bundle's input-panel components above the composer. Selecting one
 * mounts it in a sandboxed {@link BundleUiHost}; its `host.sendPrompt` is wired
 * to the chat's `send`, so a panel form turns into a prompt to Prime.
 */
export function BundlePanelLauncher({
  bundleId,
  onSendPrompt,
}: BundlePanelLauncherProps) {
  const { data: bundle } = useAgentBundle(bundleId);
  const { registry, uiNames } = useHostExtensions();
  const [selected, setSelected] = useState<string | null>(null);

  const panels = (bundle?.components ?? []).filter((c) => c.kind === "panel");
  if (panels.length === 0) return null;

  const active = panels.find((p) => p.name === selected);
  const hostOwned =
    active != null && registry != null && uiNames.has(active.name);

  return (
    <Box borderBlockStart="sm" paddingInline="sm" paddingBlock="xs">
      <BlockStack gap="2">
        <InlineStack gap="1" wrap="wrap">
          {panels.map((panel) => (
            <Button
              key={panel.name}
              variant={panel.name === selected ? "secondary" : "outline"}
              size="sm"
              onClick={() =>
                setSelected((current) =>
                  current === panel.name ? null : panel.name,
                )
              }
            >
              {panel.title ?? panel.name}
            </Button>
          ))}
        </InlineStack>
        {active ? (
          <Box border="sm" borderRadius="base" padding="sm">
            <BlockStack gap="2">
              <InlineStack
                align="space-between"
                blockAlign="center"
                wrap="nowrap"
              >
                <Text size="xs" weight="medium" tone="subdued">
                  {active.title ?? active.name}
                </Text>
                <IconButton
                  icon="X"
                  size="xs"
                  variant="ghost"
                  onClick={() => setSelected(null)}
                  aria-label="Close panel"
                />
              </InlineStack>
              {hostOwned ? (
                <HostOwnedSurface
                  key={active.name}
                  id={`panel:${bundleId}:${active.name}`}
                  surface="ui"
                  slotKey={active.name}
                  props={{
                    name: active.name,
                    kind: "panel",
                    props: {},
                    onSendPrompt: (text: string) => {
                      onSendPrompt(text);
                      setSelected(null);
                    },
                  }}
                />
              ) : (
                <BundleUiHost
                  key={active.name}
                  kind="panel"
                  moduleUrl={apiUrl(
                    `/api/agent-bundles/${bundleId}/ui/${active.name}.js`,
                  )}
                  onSendPrompt={(text) => {
                    onSendPrompt(text);
                    setSelected(null);
                  }}
                />
              )}
            </BlockStack>
          </Box>
        ) : null}
      </BlockStack>
    </Box>
  );
}
