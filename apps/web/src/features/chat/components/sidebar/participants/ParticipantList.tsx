import type {
  ParticipantKind,
  ParticipantWithMemberships,
  Presence,
} from "@tangent/shared/contracts";
import { Box } from "@tangent/ui-primitives/box";
import { Icon, type IconName } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";

import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { IconButton } from "@/shared/ui/patterns/icon-button";
import { ListRow } from "@/shared/ui/patterns/list-row";
import { Pill } from "@/shared/ui/patterns/pill";
import { Truncating } from "@/shared/ui/patterns/truncating";

import { PresenceDot } from "./PresenceDot";

interface ParticipantListProps {
  participants: ParticipantWithMemberships[];
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
  activeConversationId,
  currentUserId,
  onToggleMute,
}: ParticipantListProps) {
  const active = participants.filter((p) => !p.revokedAt).sort(rosterOrder);

  if (active.length === 0) {
    return (
      <Box padding="base">
        <EmptyState
          size="sm"
          title=""
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
          return (
            <ListRow
              key={participant.id}
              as="li"
              density="cozy"
              gap="2"
              prefix={
                <Box
                  background="info-subtle"
                  blockSize="full"
                  paddingInline="sm"
                >
                  <InlineStack fill blockAlign="center" align="center">
                    <Icon
                      name={iconFor(participant)}
                      size="lg"
                      tone="subdued"
                    />
                  </InlineStack>
                </Box>
              }
            >
              <BlockStack gap="0" align="stretch" grow>
                <InlineStack
                  gap="2"
                  wrap="nowrap"
                  blockAlign="center"
                  align="space-between"
                  grow
                >
                  <Truncating>
                    <Text
                      size="sm"
                      weight="medium"
                      truncate
                      title={participant.displayName}
                    >
                      {participant.displayName}
                      {isYou ? " (you)" : ""}
                    </Text>
                  </Truncating>
                  <InlineStack gap="1" wrap="nowrap" blockAlign="center">
                    {isOrchestrator(participant) ? (
                      <Pill tone="info">Orchestrator</Pill>
                    ) : null}
                    {muted ? <Pill muted>Muted</Pill> : null}
                    <PresenceDot presence={participant.presence} />
                    {canMute ? (
                      <IconButton
                        icon={muted ? "BellOff" : "Bell"}
                        size="xs"
                        variant="ghost"
                        aria-label={
                          muted
                            ? `Unmute ${participant.displayName}`
                            : `Mute ${participant.displayName}`
                        }
                        onClick={() =>
                          onToggleMute(
                            participant.id,
                            activeConversationId,
                            !muted,
                          )
                        }
                      />
                    ) : null}
                  </InlineStack>
                </InlineStack>
                <Text size="xs" tone="subdued" truncate>
                  {PRESENCE_LABEL[participant.presence]}
                </Text>
              </BlockStack>
            </ListRow>
          );
        })}
      </BlockStack>
    </Box>
  );
}
