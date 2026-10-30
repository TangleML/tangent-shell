import { Button } from "@tangent/ui-primitives/button";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Paragraph } from "@tangent/ui-primitives/typography";
import { type FormEvent, useState } from "react";

import { useAddBundleEditor } from "@/features/bundle-editors/hooks/useAddBundleEditor";
import { TextInput } from "@/shared/ui/patterns/text-input";
import { Truncating } from "@/shared/ui/patterns/truncating";

export function AddEditorForm() {
  const addEditor = useAddBundleEditor();
  const [email, setEmail] = useState("");

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    addEditor.mutate(trimmed, { onSuccess: () => setEmail("") });
  };

  return (
    <form onSubmit={onSubmit}>
      <BlockStack gap="2">
        <InlineStack gap="2" wrap="nowrap">
          <Truncating>
            <TextInput
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              aria-label="Editor email"
              required
              disabled={addEditor.isPending}
            />
          </Truncating>
          <Button type="submit" size="sm" disabled={addEditor.isPending}>
            {addEditor.isPending ? "Adding..." : "Add editor"}
          </Button>
        </InlineStack>
        {addEditor.isError ? (
          <Paragraph size="sm" tone="critical" role="alert">
            Failed to add editor: {addEditor.error.message}
          </Paragraph>
        ) : null}
      </BlockStack>
    </form>
  );
}
