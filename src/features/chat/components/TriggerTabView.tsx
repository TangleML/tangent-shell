import type { Trigger } from "@shared/contracts";
import type { ReactNode } from "react";

import { useDeleteTrigger } from "@/features/triggers/hooks/useDeleteTrigger";
import { useUpdateTrigger } from "@/features/triggers/hooks/useUpdateTrigger";
import { apiUrl } from "@/shared/lib/basePath";
import { Box } from "@/shared/ui/box";
import { Button } from "@/shared/ui/button";
import { Icon, type IconName } from "@/shared/ui/icon";
import { BlockStack, InlineStack } from "@/shared/ui/layout";
import { Pill } from "@/shared/ui/patterns/pill";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";
import { Section } from "@/shared/ui/patterns/section";
import { Toolbar } from "@/shared/ui/patterns/toolbar";
import { Truncating } from "@/shared/ui/patterns/truncating";
import { Heading, Paragraph, Text } from "@/shared/ui/typography";

interface TriggerTabViewProps {
  sessionId: string;
  /** The trigger this tab is dedicated to. */
  trigger: Trigger;
  /** Closes this tab (called after the trigger is deleted). */
  onClose: () => void;
}

const KIND_ICON: Record<Trigger["kind"], IconName> = {
  schedule: "Clock",
  callback: "Webhook",
};

/** A labelled detail row in the trigger's definition list. */
function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <InlineStack gap="3" wrap="nowrap" blockAlign="start">
      <Box>
        <Text as="dt" size="sm" tone="subdued">
          {label}
        </Text>
      </Box>
      <Truncating>
        <Text as="dd" size="sm">
          {children}
        </Text>
      </Truncating>
    </InlineStack>
  );
}

/** Human-readable summary of a trigger's signal source. */
function scheduleDetail(trigger: Trigger): string {
  if (trigger.schedule?.every) return `Every ${trigger.schedule.every}`;
  if (trigger.schedule?.cron) return `Cron: ${trigger.schedule.cron}`;
  return "Schedule";
}

/**
 * Detail view for a single trigger, shown in its own in-app tab. Surfaces the
 * trigger's configuration (kind, schedule or callback URL, prompt template,
 * source) and the management actions previously inline in the sidebar list:
 * enable/disable, copy the callback URL, and delete (which closes the tab).
 */
export function TriggerTabView({
  sessionId,
  trigger,
  onClose,
}: TriggerTabViewProps) {
  const update = useUpdateTrigger(sessionId);
  const remove = useDeleteTrigger(sessionId);
  const busy = update.isPending || remove.isPending;

  const callbackUrl =
    trigger.kind === "callback" && trigger.callbackPath
      ? `${__API_ORIGIN__ || window.location.origin}${apiUrl(trigger.callbackPath)}`
      : null;

  function toggle() {
    update.mutate({
      triggerId: trigger.id,
      input: { enabled: !trigger.enabled },
    });
  }

  function copyUrl() {
    if (callbackUrl) void navigator.clipboard?.writeText(callbackUrl);
  }

  function handleDelete() {
    remove.mutate(trigger.id, { onSuccess: onClose });
  }

  return (
    <BlockStack grow>
      <Toolbar chrome="light" align="end" aria-label="Trigger actions">
        <Button
          variant="toolbar"
          size="xs"
          tone={trigger.enabled ? "success" : "default"}
          disabled={busy}
          onClick={toggle}
        >
          <Icon name="Power" size="xs" />
          {trigger.enabled ? "Disable" : "Enable"}
        </Button>
        {callbackUrl ? (
          <Button variant="toolbar" size="xs" onClick={copyUrl}>
            <Icon name="Copy" size="xs" />
            Copy URL
          </Button>
        ) : null}
        <Button
          variant="toolbar"
          size="xs"
          tone="critical"
          disabled={busy}
          onClick={handleDelete}
        >
          <Icon name="Trash2" size="xs" />
          Delete
        </Button>
      </Toolbar>
      <ScrollRegion axis="y">
        <Box padding="base">
          <BlockStack gap="4">
            <InlineStack gap="2" blockAlign="center" wrap="nowrap">
              <Icon
                name={KIND_ICON[trigger.kind]}
                size="lg"
                tone={trigger.enabled ? "strong" : "subdued"}
              />
              <BlockStack gap="0">
                <Heading level={2}>{trigger.title ?? trigger.name}</Heading>
                <Text size="xs" tone="subdued">
                  {trigger.name}
                </Text>
              </BlockStack>
              <Pill size="sm" tone={trigger.enabled ? "success" : "subdued"}>
                {trigger.enabled ? "Enabled" : "Disabled"}
              </Pill>
            </InlineStack>

            <Section title="Configuration">
              <BlockStack as="dl" gap="2">
                <DetailRow label="Kind">{trigger.kind}</DetailRow>
                <DetailRow label="Source">{trigger.source}</DetailRow>
                {trigger.kind === "schedule" ? (
                  <DetailRow label="Schedule">
                    {scheduleDetail(trigger)}
                  </DetailRow>
                ) : null}
                {callbackUrl ? (
                  <DetailRow label="Callback URL">
                    <Text size="sm" font="mono" truncate title={callbackUrl}>
                      {callbackUrl}
                    </Text>
                  </DetailRow>
                ) : null}
                <DetailRow label="Handler">
                  {trigger.hasHandler ? "Compiled handler" : "Prompt template"}
                </DetailRow>
              </BlockStack>
            </Section>

            {trigger.prompt ? (
              <Section title="Prompt">
                <Paragraph size="sm" tone="subdued">
                  {trigger.prompt}
                </Paragraph>
              </Section>
            ) : null}
          </BlockStack>
        </Box>
      </ScrollRegion>
    </BlockStack>
  );
}
