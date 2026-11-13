import { Button } from "@tangent/ui-primitives/button";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";
import { useRef, useState } from "react";

import type { InstallTarget } from "./installTarget";

const FILE_ACCEPT = ".zip,.tgz,.tar,.gz,.ts,.js,.mjs,.cjs";

interface FileStepProps {
  onSelect: (target: InstallTarget) => void;
}

export function FileStep({ onSelect }: FileStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | undefined>(undefined);

  return (
    <BlockStack gap="3">
      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_ACCEPT}
        hidden
        onChange={(event) => {
          setFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <InlineStack gap="2" blockAlign="center" wrap="nowrap">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
        >
          Choose file
        </Button>
        <Text size="sm" tone="subdued">
          {file ? file.name : "No file selected"}
        </Text>
      </InlineStack>
      <InlineStack align="end">
        <Button
          type="button"
          size="sm"
          disabled={!file}
          onClick={() => file && onSelect({ kind: "file", file })}
        >
          Next
        </Button>
      </InlineStack>
    </BlockStack>
  );
}
