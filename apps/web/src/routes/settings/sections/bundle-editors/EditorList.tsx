import type { BundleEditor } from "@tangent/shared/contracts";
import { BlockStack } from "@tangent/ui-primitives/layout";
import { Paragraph, Text } from "@tangent/ui-primitives/typography";

import { useRemoveBundleEditor } from "@/features/bundle-editors/hooks/useRemoveBundleEditor";
import { IconButton } from "@/shared/ui/patterns/icon-button";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { Truncating } from "@/shared/ui/patterns/truncating";

interface EditorListProps {
  editors: BundleEditor[];
}

export function EditorList({ editors }: EditorListProps) {
  const removeEditor = useRemoveBundleEditor();

  const onRemove = (email: string) => {
    if (!window.confirm(`Remove ${email} as a bundle editor?`)) return;
    removeEditor.mutate(email);
  };

  if (editors.length === 0) {
    return (
      <Paragraph size="sm" tone="subdued">
        No bundle editors yet. Admins can always upload and delete bundles.
      </Paragraph>
    );
  }

  return (
    <BlockStack gap="1">
      {removeEditor.isError ? (
        <Paragraph size="sm" tone="critical" role="alert">
          Failed to remove editor: {removeEditor.error.message}
        </Paragraph>
      ) : null}
      <BlockStack as="ul" gap="1">
        {editors.map((editor) => (
          <ListRow as="li" key={editor.email}>
            <Truncating>
              <BlockStack gap="0.5">
                <Text size="sm" truncate>
                  {editor.email}
                </Text>
                <Text size="xs" tone="subdued" truncate>
                  Added by {editor.addedBy}
                </Text>
              </BlockStack>
            </Truncating>
            <IconButton
              icon="Trash2"
              tone="critical"
              aria-label={`Remove ${editor.email}`}
              onClick={() => onRemove(editor.email)}
              disabled={removeEditor.isPending}
            />
          </ListRow>
        ))}
      </BlockStack>
    </BlockStack>
  );
}
