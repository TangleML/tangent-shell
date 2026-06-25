import { Box } from "@tangent/ui-primitives/box";
import { Button } from "@tangent/ui-primitives/button";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Paragraph } from "@tangent/ui-primitives/typography";
import { useRef } from "react";

import { useAgentBundles } from "@/features/agent-bundles/hooks/useAgentBundles";
import { useUploadAgentBundle } from "@/features/agent-bundles/hooks/useUploadAgentBundle";
import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { PageHeader } from "@/shared/ui/patterns/page-header";
import { WorkArea } from "@/shared/ui/patterns/work-area";

import { AgentBundleCard } from "./AgentBundleCard";
import { BundleGrid } from "./bundle-grid";

export function AgentBundlesPage() {
  const { data: bundles, isLoading, error } = useAgentBundles();
  const uploadBundle = useUploadAgentBundle();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onPickBundle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so re-picking the same file still fires `change`.
    event.target.value = "";
    if (file) uploadBundle.mutate(file);
  };

  const uploadButton = (
    <InlineStack gap="2" blockAlign="center" wrap="nowrap">
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        hidden
        onChange={onPickBundle}
      />
      <Button
        variant="ghost"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploadBundle.isPending}
      >
        {uploadBundle.isPending ? "Uploading..." : "Upload bundle"}
      </Button>
    </InlineStack>
  );

  return (
    <WorkArea>
      <BlockStack gap="6">
        <PageHeader
          title="Agent bundles"
          description="Portable presets that provision a session's prompts, tools, skills, workflows, rules, and memory."
        />

        {error ? (
          <Paragraph size="sm" tone="critical">
            Failed to load agent bundles: {error.message}
          </Paragraph>
        ) : null}

        {uploadBundle.isError ? (
          <Paragraph size="sm" tone="critical">
            Failed to upload bundle: {uploadBundle.error.message}
          </Paragraph>
        ) : null}

        {isLoading ? (
          <Paragraph size="sm" tone="subdued">
            Loading agent bundles...
          </Paragraph>
        ) : null}

        {bundles && bundles.length === 0 ? (
          <EmptyState
            icon="Package"
            title="No agent bundles yet"
            description="Upload a Configuration Bundle ZIP to add it to the marketplace."
            action={uploadButton}
          />
        ) : null}

        {bundles && bundles.length > 0 ? (
          <BundleGrid>
            {bundles.map((bundle) => (
              <AgentBundleCard key={bundle.id} bundle={bundle} />
            ))}
            <Box
              padding="none"
              background="card"
              borderRadius="base"
              border="sm"
            >
              <BlockStack gap="2" fill align="center" inlineAlign="center">
                {uploadButton}
              </BlockStack>
            </Box>
          </BundleGrid>
        ) : null}
      </BlockStack>
    </WorkArea>
  );
}
