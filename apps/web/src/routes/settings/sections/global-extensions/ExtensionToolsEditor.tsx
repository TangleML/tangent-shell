import { Button } from "@tangent/ui-primitives/button";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Paragraph } from "@tangent/ui-primitives/typography";
import { type FormEvent, useState } from "react";

import { useUpdateGlobalExtension } from "@/features/global-extensions/hooks/useUpdateGlobalExtension";
import { TextInput } from "@/shared/ui/patterns/text-input";
import { Truncating } from "@/shared/ui/patterns/truncating";

interface ExtensionToolsEditorProps {
  id: string;
  tools: string[];
  onDone: () => void;
}

function parseTools(raw: string): string[] {
  return raw
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
}

export function ExtensionToolsEditor({
  id,
  tools,
  onDone,
}: ExtensionToolsEditorProps) {
  const update = useUpdateGlobalExtension();
  const [value, setValue] = useState(tools.join(", "));

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    update.mutate(
      { id, body: { tools: parseTools(value) } },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={onSubmit}>
      <BlockStack gap="2">
        <InlineStack gap="2" wrap="nowrap">
          <Truncating>
            <TextInput
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="tool-one, tool-two"
              aria-label={`Tools for ${id}`}
              disabled={update.isPending}
            />
          </Truncating>
          <Button type="submit" size="sm" disabled={update.isPending}>
            {update.isPending ? "Saving..." : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDone}
            disabled={update.isPending}
          >
            Cancel
          </Button>
        </InlineStack>
        {update.isError ? (
          <Paragraph size="sm" tone="critical" role="alert">
            Failed to save tools: {update.error.message}
          </Paragraph>
        ) : null}
      </BlockStack>
    </form>
  );
}
