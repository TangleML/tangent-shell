import { Button } from "@tangent/ui-primitives/button";
import { Checkbox } from "@tangent/ui-primitives/checkbox";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Paragraph, Text } from "@tangent/ui-primitives/typography";
import { type ReactNode, useState } from "react";

import { useInstallGlobalExtension } from "@/features/global-extensions/hooks/useInstallGlobalExtension";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { Pill } from "@/shared/ui/patterns/pill";
import { TextInput } from "@/shared/ui/patterns/text-input";
import { Truncating } from "@/shared/ui/patterns/truncating";

import { type InstallTarget, parseTools } from "./installTarget";

interface ConfirmInstallStepProps {
  target: InstallTarget;
  onBack: () => void;
  onClose: () => void;
}

// local primitive — form field pairing a caption label with its control.
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block w-full">
      <BlockStack gap="1">
        <Text size="xs" tone="subdued">
          {label}
        </Text>
        {children}
      </BlockStack>
    </label>
  );
}

function targetName(target: InstallTarget): string {
  return target.kind === "file" ? target.file.name : target.name;
}

export function ConfirmInstallStep({
  target,
  onBack,
  onClose,
}: ConfirmInstallStepProps) {
  const install = useInstallGlobalExtension();
  const [idOverride, setIdOverride] = useState("");
  const [toolsText, setToolsText] = useState("");
  const [replace, setReplace] = useState(
    target.kind === "source" && target.installed,
  );

  const submit = () => {
    const shared = {
      id: idOverride.trim() || undefined,
      tools: parseTools(toolsText),
      replace: replace || undefined,
    };
    const input =
      target.kind === "file"
        ? ({ kind: "file", file: target.file, ...shared } as const)
        : ({ kind: "source", source: target.source, ...shared } as const);
    install.mutate(input, { onSuccess: onClose });
  };

  return (
    <BlockStack gap="4">
      <ListRow density="comfortable" border="sm">
        <Truncating>
          <InlineStack gap="2" blockAlign="baseline">
            <Text size="sm" weight="medium" truncate>
              {targetName(target)}
            </Text>
            {target.kind === "source" && target.version ? (
              <Text size="xs" tone="subdued">
                v{target.version}
              </Text>
            ) : null}
            {target.kind === "source" && target.installed ? (
              <Pill size="xs" tone="subdued">
                Installed
              </Pill>
            ) : null}
          </InlineStack>
        </Truncating>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          Change
        </Button>
      </ListRow>

      <Field label="ID override (optional)">
        <TextInput
          value={idOverride}
          onChange={(event) => setIdOverride(event.target.value)}
          placeholder="derived from the package name"
        />
      </Field>

      <Field label="Tools (optional override)">
        <BlockStack gap="1">
          <TextInput
            value={toolsText}
            onChange={(event) => setToolsText(event.target.value)}
            placeholder="leave blank to auto-detect from the extension"
          />
          <Text size="xs" tone="subdued">
            Left blank, the extension's own tools are detected on install and
            can be trimmed afterward.
          </Text>
        </BlockStack>
      </Field>

      <Checkbox
        checked={replace}
        label="Replace existing install"
        onCheckedChange={setReplace}
      />

      {install.isError ? (
        <Paragraph size="sm" tone="critical" role="alert">
          Install failed: {install.error.message}
        </Paragraph>
      ) : null}

      <InlineStack gap="2" align="end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={install.isPending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={install.isPending}
        >
          {install.isPending ? "Installing..." : "Install"}
        </Button>
      </InlineStack>
    </BlockStack>
  );
}
