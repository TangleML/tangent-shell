import { Button } from "@tangent/ui-primitives/button";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { type FormEvent, useState } from "react";

import { TextInput } from "@/shared/ui/patterns/text-input";

import type { InstallTarget } from "./installTarget";

interface SourceRefStepProps {
  marketplaceId: string;
  onSelect: (target: InstallTarget) => void;
}

function refPlaceholder(marketplaceId: string): string {
  if (marketplaceId === "git") return "github.com/user/repo@v1";
  if (marketplaceId === "npm") return "pi-foo@1.2.0";
  return "package reference";
}

export function SourceRefStep({ marketplaceId, onSelect }: SourceRefStepProps) {
  const [ref, setRef] = useState("");

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = ref.trim();
    if (!trimmed) return;
    onSelect({
      kind: "source",
      source: `${marketplaceId}:${trimmed}`,
      name: trimmed,
      installed: false,
    });
  };

  return (
    <form onSubmit={onSubmit}>
      <BlockStack gap="3">
        <TextInput
          value={ref}
          onChange={(event) => setRef(event.target.value)}
          placeholder={refPlaceholder(marketplaceId)}
          aria-label={`${marketplaceId} package reference`}
          autoFocus
        />
        <InlineStack align="end">
          <Button type="submit" size="sm" disabled={!ref.trim()}>
            Next
          </Button>
        </InlineStack>
      </BlockStack>
    </form>
  );
}
