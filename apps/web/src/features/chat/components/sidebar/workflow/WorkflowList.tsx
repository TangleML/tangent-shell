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
import { BlockStack } from "@tangent/ui-primitives/layout";
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
import { ListItem } from "@/shared/ui/patterns/list-item";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";
import { Section } from "@/shared/ui/patterns/section";

interface WorkflowListProps {
  workflow: WorkflowView;
  participants: ParticipantWithMemberships[];
}

type NameFor = (id: string) => string;

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
    <ListItem
      key={reactor.id}
      icon="Hourglass"
      title={reactorLabel(reactor)}
      subtitle={reactorWaiting(reactor, nameFor)}
      flair={
        reactor.ready
          ? { kind: "pill", label: "Ready", tone: "success" }
          : { kind: "pill", label: "Waiting", tone: "info" }
      }
    />
  );
}

function runRow(run: WorkflowRun, nameFor: NameFor) {
  const subtitle = run.externalId
    ? `${run.ingress} \u00b7 ${run.externalId}`
    : run.ingress;
  return (
    <ListItem
      key={run.id}
      icon="Play"
      title={nameFor(run.participantId)}
      subtitle={subtitle}
      flair={
        run.admissionQueueDepth > 0
          ? {
              kind: "pill",
              label: `${run.admissionQueueDepth} queued`,
              tone: "warning",
            }
          : undefined
      }
    />
  );
}

function waveRow(wave: WorkflowWave, nameFor: NameFor) {
  return (
    <ListItem
      key={wave.participantId}
      icon="WavesHorizontal"
      title={nameFor(wave.participantId)}
      subtitle={`depth ${wave.depth} of ${wave.budget}`}
      flair={
        wave.depth >= wave.budget
          ? { kind: "pill", label: "At budget", tone: "warning" }
          : undefined
      }
    />
  );
}

function correlationRow(correlation: OutstandingCorrelation, nameFor: NameFor) {
  const askedOf = correlation.askedOf ? nameFor(correlation.askedOf) : "anyone";
  return (
    <ListItem
      key={correlation.id}
      icon="ArrowLeftRight"
      title={`${nameFor(correlation.askedBy)} \u2192 ${askedOf}`}
      subtitle={`expires ${formatInstant(correlation.expiresAt)}`}
    />
  );
}

function digestRow(digest: Resource) {
  return (
    <ListItem
      key={digest.id}
      icon="ScrollText"
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
    <ListItem
      key={`${cause.kind}-${cause.participantId}-${index}`}
      icon="TriangleAlert"
      title={causeLabel(cause)}
      subtitle={scope}
      flair={{ kind: "pill", label: "Cause", tone: "critical" }}
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
                <ListItem
                  key={`${range.fromSeq}-${range.toSeq}`}
                  icon="EyeOff"
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
