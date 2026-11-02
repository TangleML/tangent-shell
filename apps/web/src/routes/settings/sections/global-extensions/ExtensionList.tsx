import type { GlobalExtensionMeta } from "@tangent/shared/contracts";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Paragraph, Text } from "@tangent/ui-primitives/typography";
import { useState } from "react";

import { useUninstallGlobalExtension } from "@/features/global-extensions/hooks/useUninstallGlobalExtension";
import { IconButton } from "@/shared/ui/patterns/icon-button";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { Pill } from "@/shared/ui/patterns/pill";
import { Truncating } from "@/shared/ui/patterns/truncating";

import { ExtensionToolsEditor } from "./ExtensionToolsEditor";

interface ExtensionListProps {
  extensions: GlobalExtensionMeta[];
  canManage: boolean;
}

function resourceSummary(resources: GlobalExtensionMeta["resources"]): string {
  const parts: string[] = [];
  if (resources.extensions.length > 0) {
    parts.push(`${resources.extensions.length} extensions`);
  }
  if (resources.skills.length > 0) {
    parts.push(`${resources.skills.length} skills`);
  }
  if (resources.prompts.length > 0) {
    parts.push(`${resources.prompts.length} prompts`);
  }
  return parts.join(", ");
}

function ExtensionRow({
  extension,
  canManage,
}: {
  extension: GlobalExtensionMeta;
  canManage: boolean;
}) {
  const uninstall = useUninstallGlobalExtension();
  const [editing, setEditing] = useState(false);

  const onRemove = () => {
    if (!window.confirm(`Uninstall ${extension.name}?`)) return;
    uninstall.mutate(extension.id);
  };

  const summary = resourceSummary(extension.resources);

  return (
    <ListRow as="li" density="comfortable">
      <Truncating>
        <BlockStack gap="2">
          <InlineStack gap="2" blockAlign="center">
            <Truncating>
              <BlockStack gap="0.5">
                <InlineStack gap="2" blockAlign="baseline">
                  <Text size="sm" weight="medium" truncate>
                    {extension.name}
                  </Text>
                  {extension.version ? (
                    <Text size="xs" tone="subdued">
                      v{extension.version}
                    </Text>
                  ) : null}
                </InlineStack>
                <Text size="xs" tone="subdued" truncate>
                  {extension.id}
                </Text>
              </BlockStack>
            </Truncating>
            <Pill size="xs" tone="subdued" title={extension.source.ref}>
              {extension.source.marketplace}
            </Pill>
            <Pill
              size="xs"
              tone={extension.status === "ready" ? "success" : "critical"}
            >
              {extension.status}
            </Pill>
          </InlineStack>

          {extension.status === "error" && extension.error ? (
            <Paragraph size="xs" tone="critical">
              {extension.error}
            </Paragraph>
          ) : null}

          {summary ? (
            <Text size="xs" tone="subdued">
              {summary}
            </Text>
          ) : null}

          {editing ? (
            <ExtensionToolsEditor
              id={extension.id}
              tools={extension.tools}
              onDone={() => setEditing(false)}
            />
          ) : extension.tools.length > 0 ? (
            <InlineStack gap="1">
              {extension.tools.map((tool) => (
                <Pill key={tool} size="xs">
                  {tool}
                </Pill>
              ))}
            </InlineStack>
          ) : null}

          {uninstall.isError ? (
            <Paragraph size="xs" tone="critical" role="alert">
              Failed to uninstall: {uninstall.error.message}
            </Paragraph>
          ) : null}
        </BlockStack>
      </Truncating>

      {canManage ? (
        <InlineStack gap="1" wrap="nowrap">
          <IconButton
            icon="Pencil"
            aria-label={`Edit tools for ${extension.name}`}
            onClick={() => setEditing((prev) => !prev)}
          />
          <IconButton
            icon="Trash2"
            tone="critical"
            aria-label={`Uninstall ${extension.name}`}
            onClick={onRemove}
            disabled={uninstall.isPending}
          />
        </InlineStack>
      ) : null}
    </ListRow>
  );
}

export function ExtensionList({ extensions, canManage }: ExtensionListProps) {
  if (extensions.length === 0) {
    return (
      <Paragraph size="sm" tone="subdued">
        No extensions installed yet.
      </Paragraph>
    );
  }

  return (
    <BlockStack as="ul" gap="2">
      {extensions.map((extension) => (
        <ExtensionRow
          key={extension.id}
          extension={extension}
          canManage={canManage}
        />
      ))}
    </BlockStack>
  );
}
