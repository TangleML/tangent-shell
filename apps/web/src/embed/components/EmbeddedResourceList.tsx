import type { Resource } from "@tangent/shared/contracts";
import { PI_AGENT } from "@tangent/shared/contracts";
import { Box } from "@tangent/ui-primitives/box";

import { ResourceList } from "@/features/chat/components/sidebar/resources/ResourceList";
import { useSessionChat } from "@/features/chat/hooks/useSessionChat";
import { useSessionParticipants } from "@/features/chat/hooks/useSessionParticipants";
import { useSessionResources } from "@/features/chat/hooks/useSessionResources";
import { apiUrl } from "@/shared/lib/basePath";
import { resolveUrl } from "@/shared/lib/markdown/artifact";
import { ScrollRegion } from "@/shared/ui/patterns/scroll-region";

import type { EmbedResourcePayload } from "../types";

interface EmbeddedResourceListProps {
  sessionId: string;
  /** Scopes the catalog to a sub-agent's Conversation; defaults to Prime's. */
  agentId?: string;
  onOpen: (resource: EmbedResourcePayload) => void;
}

function toPayload(resource: Resource, url: string): EmbedResourcePayload {
  return {
    id: resource.id,
    kind: resource.kind,
    name: resource.name,
    uri: resource.uri,
    url,
    authorParticipantId: resource.authorParticipantId,
  };
}

/**
 * The embedded resource list: the session's catalogued content, read-only.
 * Opening a viewable `file`/`artifact` resolves its uri to the file API url and
 * emits `onOpen` so the host can place an artifact viewer; other kinds are
 * inert, mirroring the Resources window.
 */
export function EmbeddedResourceList({
  sessionId,
  agentId,
  onOpen,
}: EmbeddedResourceListProps) {
  const chat = useSessionChat(sessionId);
  const activeConversationId = chat.conversationForAgent(
    agentId || PI_AGENT.id,
  );

  const { data: participants = [] } = useSessionParticipants(sessionId);

  // Scope the catalog to the current human when they are an invited Participant,
  // so surfacing consults their per-Conversation grants; the owner keeps the
  // whole catalog. Mirrors SessionChat.
  const currentParticipant = participants.find(
    (p) => p.id === chat.currentAuthorId && !p.revokedAt,
  );
  const resourceScope = currentParticipant
    ? {
        conversationId: activeConversationId,
        participantId: currentParticipant.id,
      }
    : undefined;

  const { data: resources = [] } = useSessionResources(
    sessionId,
    resourceScope,
  );

  return (
    <ScrollRegion>
      <Box inlineSize="full">
        <ResourceList
          resources={resources}
          onOpen={(resource) => {
            const base = apiUrl(`/api/sessions/${sessionId}/files`);
            const url = resolveUrl(resource.uri, base) ?? resource.uri;
            onOpen(toPayload(resource, url));
          }}
        />
      </Box>
    </ScrollRegion>
  );
}
