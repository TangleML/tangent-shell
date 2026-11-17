import type {
  ParticipantKind,
  ParticipantWithMemberships,
  Presence,
  RemoteEnvironmentInfo,
} from "@tangent/shared/contracts";
import { Box } from "@tangent/ui-primitives/box";
import type { IconName } from "@tangent/ui-primitives/icon";
import { BlockStack } from "@tangent/ui-primitives/layout";

import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { ListItem, type ListItemFlair } from "@/shared/ui/patterns/list-item";

import { EnvironmentRow } from "./EnvironmentRow";

interface ParticipantListProps {
  participants: ParticipantWithMemberships[];
  /** Connected remote environments, listed read-only after the roster. */
  environments?: RemoteEnvironmentInfo[];
  /**
   * The Conversation currently in view; a participant's mute toggle acts on its
   * Membership there. Muting is only meaningful for a member of this thread.
   */
  activeConversationId: string;
  /** The current human's participant id, so their own row reads as "you". */
  currentUserId: string;
  /** Mutes/unmutes an agent's Membership in the active Conversation. */
  onToggleMute: (
    participantId: string,
    conversationId: string,
    muted: boolean,
  ) => void;
  /** Whether a mute toggle is in flight, so the controls disable meanwhile. */
  isToggleMutePending?: boolean;
}

const KIND_ICON: Record<ParticipantKind, IconName> = {
  human: "User",
  agent: "Bot",
  automation: "Zap",
};

function isOrchestrator(participant: ParticipantWithMemberships): boolean {
  return participant.capabilities.includes("orchestrator");
}

function iconFor(participant: ParticipantWithMemberships): IconName {
  return isOrchestrator(participant) ? "Crown" : KIND_ICON[participant.kind];
}

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "Connected",
  away: "Away",
  detached: "Detached",
};

const PRESENCE_FLAIR: Record<Presence, ListItemFlair> = {
  connected: {
    kind: "dot",
    variant: "active",
    label: PRESENCE_LABEL.connected,
  },
  away: { kind: "dot", variant: "away", label: PRESENCE_LABEL.away },
  detached: {
    kind: "dot",
    variant: "disconnected",
    label: PRESENCE_LABEL.detached,
  },
};

// A row has one flair (presence), so role and mute state ride in the subtitle.
function participantSubtitle(
  participant: ParticipantWithMemberships,
  muted: boolean,
): string {
  return [
    isOrchestrator(participant) ? "Orchestrator" : null,
    PRESENCE_LABEL[participant.presence],
    muted ? "Muted" : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/**
 * Orders the roster so the thread reads top-down: the orchestrator first (its
 * thread looks primary, derived from the capability rather than a reserved id),
 * then other agents, humans, and automations, each alphabetical within its band.
 */
function rosterOrder(
  a: ParticipantWithMemberships,
  b: ParticipantWithMemberships,
): number {
  const rank = (p: ParticipantWithMemberships) =>
    isOrchestrator(p) ? 0 : p.kind === "agent" ? 1 : p.kind === "human" ? 2 : 3;
  return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName);
}

/**
 * The session's roster: every Participant (humans, agents, automations) with
 * live presence, the orchestrator marked by its capability, and a mute toggle
 * for an agent that belongs to the Conversation in view. Muting sets the
 * Membership's reaction to `never` (the visibility change falls out of the
 * primitive) so the agent stops waking in that thread.
 */
export function ParticipantList({
  participants,
  environments = [],
  activeConversationId,
  currentUserId,
  onToggleMute,
  isToggleMutePending = false,
}: ParticipantListProps) {
  const active = participants.filter((p) => !p.revokedAt).sort(rosterOrder);

  if (active.length === 0 && environments.length === 0) {
    return (
      <Box padding="base">
        <EmptyState
          size="sm"
          title="No one here yet"
          description="Everyone in this session — people, agents, and automations — shows up here with their presence."
        />
      </Box>
    );
  }

  return (
    <Box padding="sm">
      <BlockStack as="ul" gap="1">
        {active.map((participant) => {
          const membership = participant.memberships.find(
            (m) => m.conversationId === activeConversationId,
          );
          const canMute = participant.kind === "agent" && Boolean(membership);
          const muted = membership?.muted ?? false;
          const isYou = participant.id === currentUserId;
          const name = participant.displayName;
          return (
            <ListItem
              key={participant.id}
              icon={iconFor(participant)}
              title={isYou ? `${name} (you)` : name}
              subtitle={participantSubtitle(participant, muted)}
              flair={PRESENCE_FLAIR[participant.presence]}
              actions={
                canMute
                  ? [
                      {
                        icon: muted ? "BellOff" : "Bell",
                        label: muted ? `Unmute ${name}` : `Mute ${name}`,
                        disabled: isToggleMutePending,
                        onClick: () =>
                          onToggleMute(
                            participant.id,
                            activeConversationId,
                            !muted,
                          ),
                      },
                    ]
                  : undefined
              }
            />
          );
        })}
        {environments.map((environment) => (
          <EnvironmentRow
            key={environment.environmentId}
            environment={environment}
          />
        ))}
      </BlockStack>
    </Box>
  );
}
