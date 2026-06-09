import type { Trigger } from "@shared/contracts";

import { SidebarColumn } from "@/features/chat/components/SidebarColumn";
import { Box } from "@/shared/ui/box";
import { Icon, type IconName } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { IconButton } from "@/shared/ui/patterns/icon-button";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";
import { Toolbar } from "@/shared/ui/patterns/toolbar";
import { Truncating } from "@/shared/ui/patterns/truncating";
import { Text } from "@/shared/ui/typography";

import { useDeleteTrigger } from "../hooks/useDeleteTrigger";
import { useUpdateTrigger } from "../hooks/useUpdateTrigger";

interface TriggerListProps {
  sessionId: string;
  triggers: Trigger[];
}

const KIND_ICON: Record<Trigger["kind"], IconName> = {
  schedule: "Clock",
  callback: "Webhook",
};

/** Human-readable summary of a trigger's signal source. */
function triggerDetail(trigger: Trigger): string {
  if (trigger.kind === "schedule") {
    const every = trigger.schedule?.every ?? trigger.schedule?.cron;
    return every ? `Every ${every}` : "Schedule";
  }
  return "Callback URL";
}

// Enabled triggers float to the top; within a group, sort by name for stable
// scanning.
function sortTriggers(triggers: Trigger[]): Trigger[] {
  return [...triggers].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

interface TriggerRowProps {
  trigger: Trigger;
  onToggle: () => void;
  onCopy: () => void;
  onDelete: () => void;
  busy: boolean;
}

function TriggerRow({
  trigger,
  onToggle,
  onCopy,
  onDelete,
  busy,
}: TriggerRowProps) {
  const label = trigger.title ?? trigger.name;
  return (
    <ListRow as="li" density="cozy" gap="2">
      <Icon
        name={KIND_ICON[trigger.kind]}
        size="sm"
        tone={trigger.enabled ? "strong" : "subdued"}
      />
      <Truncating>
        <BlockStack gap="0">
          <Text
            size="sm"
            weight={trigger.enabled ? "medium" : "regular"}
            tone={trigger.enabled ? "inherit" : "subdued"}
            truncate
            title={label}
          >
            {label}
          </Text>
          <InlineStack gap="1" wrap="nowrap" blockAlign="center">
            <Text size="xs" tone="subdued" truncate>
              {triggerDetail(trigger)}
              {trigger.enabled ? "" : " · off"}
            </Text>
            <InlineStack gap="1" wrap="nowrap" blockAlign="center">
              <IconButton
                icon="Power"
                size="xs"
                tone={trigger.enabled ? "success" : "default"}
                disabled={busy}
                aria-label={
                  trigger.enabled ? "Disable trigger" : "Enable trigger"
                }
                onClick={onToggle}
              />
              {trigger.kind === "callback" && trigger.callbackPath ? (
                <IconButton
                  icon="Copy"
                  size="xs"
                  aria-label="Copy callback URL"
                  onClick={onCopy}
                />
              ) : null}
              <IconButton
                icon="Trash2"
                size="xs"
                tone="critical"
                disabled={busy}
                aria-label="Delete trigger"
                onClick={onDelete}
              />
            </InlineStack>
          </InlineStack>
        </BlockStack>
      </Truncating>
    </ListRow>
  );
}

/**
 * Sidebar panel listing the session's triggers. Triggers are created by Prime
 * (via the user asking) or seeded from the bundle; this panel manages them:
 * enable/disable, copy a callback URL, and delete. State arrives over the
 * socket trigger roster, so mutations need no manual refetch.
 */
export function TriggerList({ sessionId, triggers }: TriggerListProps) {
  const update = useUpdateTrigger(sessionId);
  const remove = useDeleteTrigger(sessionId);
  const enabledCount = triggers.filter((t) => t.enabled).length;
  const busy = update.isPending || remove.isPending;

  const copyCallback = (trigger: Trigger): void => {
    if (!trigger.callbackPath) return;
    const url = `${window.location.origin}${trigger.callbackPath}`;
    void navigator.clipboard?.writeText(url);
  };

  return (
    <SidebarColumn>
      <Toolbar chrome="light" gap="2" align="space-between">
        <InlineStack gap="2" blockAlign="center" wrap="nowrap">
          <Icon name="Zap" size="md" tone="subdued" />
          <Text size="xs" weight="medium">
            Triggers
          </Text>
        </InlineStack>
        {enabledCount > 0 ? (
          <Text size="xs" tone="subdued">
            {enabledCount} on
          </Text>
        ) : null}
      </Toolbar>
      <ScrollRegion axis="y">
        <Box padding="sm">
          {triggers.length === 0 ? (
            <Box paddingInline="sm" paddingBlock="xs">
              <Text size="xs" tone="subdued">
                No triggers yet. Ask Prime to create a schedule or callback
                trigger.
              </Text>
            </Box>
          ) : (
            <BlockStack as="ul" gap="1">
              {sortTriggers(triggers).map((trigger) => (
                <TriggerRow
                  key={trigger.id}
                  trigger={trigger}
                  busy={busy}
                  onToggle={() =>
                    update.mutate({
                      triggerId: trigger.id,
                      input: { enabled: !trigger.enabled },
                    })
                  }
                  onCopy={() => copyCallback(trigger)}
                  onDelete={() => remove.mutate(trigger.id)}
                />
              ))}
            </BlockStack>
          )}
        </Box>
      </ScrollRegion>
    </SidebarColumn>
  );
}
