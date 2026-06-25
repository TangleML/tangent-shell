import { Button } from "@tangent/ui-primitives/button";
import { BlockStack } from "@tangent/ui-primitives/layout";
import { Textarea } from "@tangent/ui-primitives/textarea";
import { Paragraph } from "@tangent/ui-primitives/typography";
import { useState } from "react";

import { useGlobalMemory } from "@/features/global-memory/hooks/useGlobalMemory";
import { useUpdateGlobalMemory } from "@/features/global-memory/hooks/useUpdateGlobalMemory";
import { CrumbCurrent } from "@/shared/ui/patterns/breadcrumbs";
import { PageHeader } from "@/shared/ui/patterns/page-header";
import { Section } from "@/shared/ui/patterns/section";
import { WorkArea } from "@/shared/ui/patterns/work-area";

export function GlobalMemoryPage() {
  const { data, isLoading, error } = useGlobalMemory();
  const updateMemory = useUpdateGlobalMemory();
  const [value, setValue] = useState("");
  const [syncedContent, setSyncedContent] = useState<string | undefined>(
    undefined,
  );

  // Seed the editor from the fetched content (and reset after a save, when the
  // query cache updates to the stored value) by adjusting state during render
  // rather than in an effect. See react.dev "You Might Not Need an Effect".
  if (data !== undefined && data !== syncedContent) {
    setSyncedContent(data);
    setValue(data);
  }

  const isDirty = data !== undefined && value !== data;
  const isSaving = updateMemory.isPending;

  const saveButton = (
    <Button
      disabled={!isDirty || isSaving || isLoading}
      onClick={() => updateMemory.mutate(value)}
    >
      {isSaving ? "Saving..." : "Save"}
    </Button>
  );

  return (
    <WorkArea>
      <BlockStack gap="6" align="stretch">
        <PageHeader
          breadcrumb={<CrumbCurrent>Global memory</CrumbCurrent>}
          title="Global memory"
          description="Standing context shared with every session's agents. Edits apply to new sessions; running sessions pick them up on their next spawn."
        />

        {error ? (
          <Paragraph size="sm" tone="critical">
            Failed to load global memory: {error.message}
          </Paragraph>
        ) : null}

        {updateMemory.isError ? (
          <Paragraph size="sm" tone="critical">
            Failed to save global memory: {updateMemory.error.message}
          </Paragraph>
        ) : null}

        <Section title="GLOBAL_MEMORY.md" actions={saveButton}>
          <Textarea
            rows={24}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={isLoading || isSaving}
            placeholder={
              isLoading
                ? "Loading global memory..."
                : "Add facts the agents should always know..."
            }
            aria-label="Global memory content"
          />
        </Section>
      </BlockStack>
    </WorkArea>
  );
}
