import { Button } from "@tangent/ui-primitives/button";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";
import { type KeyboardEvent, useState } from "react";

interface SessionRenameFormProps {
  initialName: string;
  pending: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

/** Inline rename field used inside the session rename popover. */
export function SessionRenameForm({
  initialName,
  pending,
  onSubmit,
  onCancel,
}: SessionRenameFormProps) {
  const [value, setValue] = useState(initialName);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSubmit(value);
    }
  };

  return (
    <BlockStack gap="2">
      {/* Raw input: a styled single-line field, exempt from
          tangle-ui/no-classname-on-primitives like SessionFilterInput. */}
      <input
        type="text"
        value={value}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Session name"
        className="placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none transition-[color,box-shadow] focus-visible:ring-[3px]"
      />
      <InlineStack gap="2" align="end">
        <Button variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="default"
          size="xs"
          disabled={pending}
          onClick={() => onSubmit(value)}
        >
          {pending ? "Saving..." : "Save"}
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

interface SessionDeleteConfirmProps {
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Inline delete confirmation used inside the session delete popover. */
export function SessionDeleteConfirm({
  pending,
  onConfirm,
  onCancel,
}: SessionDeleteConfirmProps) {
  return (
    <BlockStack gap="2">
      <Text size="sm">Delete this session? This can't be undone.</Text>
      <InlineStack gap="2" align="end">
        <Button variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="xs"
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? "Deleting..." : "Delete"}
        </Button>
      </InlineStack>
    </BlockStack>
  );
}

interface SessionBundleReinstallConfirmProps {
  installedVersion: string;
  /** The stored version to install; `undefined` when it is no longer stored. */
  storedVersion?: string;
  pending: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Inline confirmation for updating or reinstalling a session's bundle. */
export function SessionBundleReinstallConfirm({
  installedVersion,
  storedVersion,
  pending,
  error,
  onConfirm,
  onCancel,
}: SessionBundleReinstallConfirmProps) {
  const isUpdate =
    storedVersion !== undefined && storedVersion !== installedVersion;
  const action = isUpdate ? "Update" : "Reinstall";
  const pendingLabel = isUpdate ? "Updating..." : "Reinstalling...";

  return (
    <BlockStack gap="2">
      <Text size="sm">
        {isUpdate
          ? `Update the bundle from v${installedVersion} to v${storedVersion}?`
          : `Reinstall bundle v${installedVersion}?`}
      </Text>
      <Text size="sm" tone="subdued">
        Prime and its sub-agents restart with the new prompts, rules, skills and
        tools. Chats, memory and workspace files are kept.
      </Text>
      {storedVersion === undefined ? (
        <Text size="sm" tone="critical" role="alert">
          This bundle is no longer in the marketplace.
        </Text>
      ) : null}
      {error ? (
        <Text size="sm" tone="critical" role="alert">
          {error}
        </Text>
      ) : null}
      <InlineStack gap="2" align="end">
        <Button variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="default"
          size="xs"
          disabled={pending || storedVersion === undefined}
          onClick={onConfirm}
        >
          {pending ? pendingLabel : action}
        </Button>
      </InlineStack>
    </BlockStack>
  );
}
