import { useState } from "react";

import { useAgentBundle } from "@/features/agent-bundles/hooks/useAgentBundle";
import { BundleUiHost } from "@/features/bundle-ui/BundleUiHost";
import { Box } from "@/shared/ui/box";
import { Button } from "@/shared/ui/button";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { IconButton } from "@/shared/ui/patterns/icon-button";
import { Text } from "@/shared/ui/typography";

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
  const [selected, setSelected] = useState<string | null>(null);

  const panels = (bundle?.components ?? []).filter((c) => c.kind === "panel");
  if (panels.length === 0) return null;

  const active = panels.find((p) => p.name === selected);

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
              <InlineStack align="space-between" blockAlign="center" wrap="nowrap">
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
              <BundleUiHost
                key={active.name}
                kind="panel"
                moduleUrl={`/api/agent-bundles/${bundleId}/ui/${active.name}.js`}
                onSendPrompt={(text) => {
                  onSendPrompt(text);
                  setSelected(null);
                }}
              />
            </BlockStack>
          </Box>
        ) : null}
      </BlockStack>
    </Box>
  );
}
