import type {
  OutstandingCorrelation,
  ParticipantWithMemberships,
  Resource,
  TerminationCause,
  WorkflowReactor,
  WorkflowRun,
  WorkflowView,
  WorkflowWave,
} from "@tangent/shared/contracts";
import { Box } from "@tangent/ui-primitives/box";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";
import type { ReactNode } from "react";

import {
  causeLabel,
  digestRange,
  displayNameFor,
  formatInstant,
  reactorLabel,
  reactorWaiting,
} from "@/features/chat/model/workflow";
import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { Pill } from "@/shared/ui/patterns/pill";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";
import { Section } from "@/shared/ui/patterns/section";
import { Truncating } from "@/shared/ui/patterns/truncating";

interface WorkflowListProps {
  workflow: WorkflowView;
  participants: ParticipantWithMemberships[];
}

type NameFor = (id: string) => string;

function Row({
  title,
  subtitle,
  trailing,
}: {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
}) {
  return (
    <ListRow as="li" density="cozy" gap="2">
      <BlockStack gap="0" align="stretch" grow>
        <InlineStack gap="2" wrap="nowrap" align="space-between" grow>
          <Truncating>
            <Text size="sm" weight="medium" truncate title={title}>
              {title}
            </Text>
          </Truncating>
          {trailing}
        </InlineStack>
        {subtitle ? (
          <Text size="xs" tone="subdued" truncate>
            {subtitle}
          </Text>
        ) : null}
      </BlockStack>
    </ListRow>
  );
}

function WorkflowSection({
  title,
  empty,
  emptyText,
  children,
}: {
  title: string;
  empty: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <Section title={title} headingLevel={4}>
      {empty ? (
        <Text size="sm" tone="subdued">
          {emptyText}
        </Text>
      ) : (
        <BlockStack as="ul" gap="1">
          {children}
        </BlockStack>
      )}
    </Section>
  );
}

function reactorRow(reactor: WorkflowReactor, nameFor: NameFor) {
  return (
    <Row
      key={reactor.id}
      title={reactorLabel(reactor)}
      subtitle={reactorWaiting(reactor, nameFor)}
      trailing={
        <Pill tone={reactor.ready ? "success" : "info"}>
          {reactor.ready ? "Ready" : "Waiting"}
        </Pill>
      }
    />
  );
}

function runRow(run: WorkflowRun, nameFor: NameFor) {
  const subtitle = run.externalId
    ? `${run.ingress} \u00b7 ${run.externalId}`
    : run.ingress;
  return (
    <Row
      key={run.id}
      title={nameFor(run.participantId)}
      subtitle={subtitle}
      trailing={
        run.admissionQueueDepth > 0 ? (
          <Pill tone="warning">{run.admissionQueueDepth} queued</Pill>
        ) : null
      }
    />
  );
}

function waveRow(wave: WorkflowWave, nameFor: NameFor) {
  return (
    <Row
      key={wave.participantId}
      title={nameFor(wave.participantId)}
      subtitle={`depth ${wave.depth} of ${wave.budget}`}
      trailing={
        wave.depth >= wave.budget ? <Pill tone="warning">At budget</Pill> : null
      }
    />
  );
}

function correlationRow(correlation: OutstandingCorrelation, nameFor: NameFor) {
  const askedOf = correlation.askedOf ? nameFor(correlation.askedOf) : "anyone";
  return (
    <Row
      key={correlation.id}
      title={`${nameFor(correlation.askedBy)} \u2192 ${askedOf}`}
      subtitle={`expires ${formatInstant(correlation.expiresAt)}`}
    />
  );
}

function digestRow(digest: Resource) {
  return (
    <Row
      key={digest.id}
      title={digest.name}
      subtitle={digestRange(digest) ?? digest.uri}
    />
  );
}

function causeRow(cause: TerminationCause, index: number, nameFor: NameFor) {
  const scope =
    cause.waveDepth > 0
      ? `${nameFor(cause.participantId)} \u00b7 wave ${cause.waveDepth}`
      : nameFor(cause.participantId);
  return (
    <Row
      key={`${cause.kind}-${cause.participantId}-${index}`}
      title={causeLabel(cause)}
      subtitle={scope}
      trailing={<Pill tone="critical">Cause</Pill>}
    />
  );
}

/**
 * The workflow debugging surface: a Conversation's reactors and what they are
 * waiting on, its open Runs, live waves, outstanding correlations, digest
 * coverage, and structured causes — the checkable facts that stand in for
 * reading a stalled transcript and guessing. The transient facts are a live
 * snapshot, so an empty section reads as "nothing outstanding", not lost.
 */
export function WorkflowList({ workflow, participants }: WorkflowListProps) {
  const nameFor = displayNameFor(participants);
  const omitted = workflow.room?.omitted ?? [];
  const isEmpty =
    workflow.reactors.length === 0 &&
    workflow.runs.length === 0 &&
    workflow.waves.length === 0 &&
    workflow.correlations.length === 0 &&
    workflow.digests.length === 0 &&
    workflow.causes.length === 0 &&
    omitted.length === 0;

  if (isEmpty) {
    return (
      <Box padding="base">
        <EmptyState
          size="sm"
          title="Nothing outstanding"
          description="No reactors are waiting, no Runs are open, and nothing has stalled in this conversation."
        />
      </Box>
    );
  }

  return (
    <ScrollRegion>
      <Box padding="sm">
        <BlockStack gap="2">
          <WorkflowSection
            title="Reactors"
            empty={workflow.reactors.length === 0}
            emptyText="No reactors installed."
          >
            {workflow.reactors.map((reactor) => reactorRow(reactor, nameFor))}
          </WorkflowSection>

          <WorkflowSection
            title="Open runs"
            empty={workflow.runs.length === 0}
            emptyText="Nothing outstanding."
          >
            {workflow.runs.map((run) => runRow(run, nameFor))}
          </WorkflowSection>

          <WorkflowSection
            title="Waves"
            empty={workflow.waves.length === 0}
            emptyText="Nothing outstanding."
          >
            {workflow.waves.map((wave) => waveRow(wave, nameFor))}
          </WorkflowSection>

          <WorkflowSection
            title="Correlations"
            empty={workflow.correlations.length === 0}
            emptyText="Nothing outstanding."
          >
            {workflow.correlations.map((correlation) =>
              correlationRow(correlation, nameFor),
            )}
          </WorkflowSection>

          <WorkflowSection
            title="Digests"
            empty={workflow.digests.length === 0}
            emptyText="No digests."
          >
            {workflow.digests.map((digest) => digestRow(digest))}
          </WorkflowSection>

          <WorkflowSection
            title="Causes"
            empty={workflow.causes.length === 0}
            emptyText="No causes."
          >
            {workflow.causes.map((cause, index) =>
              causeRow(cause, index, nameFor),
            )}
          </WorkflowSection>

          {omitted.length > 0 ? (
            <WorkflowSection title="Omitted" empty={false} emptyText="">
              {omitted.map((range) => (
                <Row
                  key={`${range.fromSeq}-${range.toSeq}`}
                  title="There was more here"
                  subtitle={`seq ${range.fromSeq}\u2013${range.toSeq}`}
                />
              ))}
            </WorkflowSection>
          ) : null}
        </BlockStack>
      </Box>
    </ScrollRegion>
  );
}
