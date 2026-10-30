import { BlockStack } from "@tangent/ui-primitives/layout";
import { Heading, Paragraph, Text } from "@tangent/ui-primitives/typography";

import { useBundleEditors } from "@/features/bundle-editors/hooks/useBundleEditors";
import { useMyPermissions } from "@/features/user/hooks/useMyPermissions";
import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { Section } from "@/shared/ui/patterns/section";

import { AddEditorForm } from "./AddEditorForm";
import { EditorList } from "./EditorList";

function BundleEditorsContent() {
  const { data, isLoading, error } = useBundleEditors();

  if (error) {
    return (
      <Paragraph size="sm" tone="critical">
        Failed to load bundle editors: {error.message}
      </Paragraph>
    );
  }
  if (isLoading || !data) {
    return (
      <Paragraph size="sm" tone="subdued">
        Loading bundle editors...
      </Paragraph>
    );
  }

  return (
    <>
      <Section title="Editors">
        <BlockStack gap="4">
          <AddEditorForm />
          <EditorList editors={data.editors} />
        </BlockStack>
      </Section>

      <Section title="Admins (from environment)">
        {data.admins.length === 0 ? (
          <Paragraph size="sm" tone="subdued">
            No admins are configured, so anyone can manage bundles and global
            memory. Set ADMIN_EMAILS to turn on access control.
          </Paragraph>
        ) : (
          <BlockStack as="ul" gap="1">
            {data.admins.map((email) => (
              <ListRow as="li" key={email}>
                <Text size="sm">{email}</Text>
              </ListRow>
            ))}
          </BlockStack>
        )}
      </Section>
    </>
  );
}

function AdminGate() {
  const { isAdmin, isLoading } = useMyPermissions();

  if (isLoading) return null;
  if (isAdmin) return <BundleEditorsContent />;
  return (
    <EmptyState
      icon="Lock"
      title="Admins only"
      description="You don't have access to manage bundle editors."
    />
  );
}

export function BundleEditorsSettings() {
  return (
    <BlockStack gap="6" align="stretch">
      <BlockStack gap="1">
        <Heading level={2}>Bundle editors</Heading>
        <Paragraph size="sm" tone="subdued">
          People who can upload and delete agent bundles. Admins are always
          editors and can also edit global memory.
        </Paragraph>
      </BlockStack>
      <AdminGate />
    </BlockStack>
  );
}
