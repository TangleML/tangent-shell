import type { Resource } from "@tangent/shared/contracts";
import { PI_AGENT } from "@tangent/shared/contracts";

import {
  CHAT_TAB_VALUE,
  useAssetTabs,
} from "@/features/chat/hooks/useAssetTabs";
import { useSessionChat } from "@/features/chat/hooks/useSessionChat";
import {
  useMuteMembership,
  useSessionParticipants,
} from "@/features/chat/hooks/useSessionParticipants";
import { useSessionResources } from "@/features/chat/hooks/useSessionResources";
import { type Agent, buildAgents } from "@/features/chat/model/agents";
import { buildAssets } from "@/features/chat/model/assets";
import { buildMentionCandidates } from "@/features/chat/model/mentions";
import { useSession } from "@/features/sessions/hooks/useSession";
import { apiUrl } from "@/shared/lib/basePath";
import { isViewableArtifact, resolveUrl } from "@/shared/lib/markdown/artifact";

import type { SessionChatWindowsValue } from "../components/windows/SessionChatWindowsContext";

/**
 * Everything the {@link import("../components/SessionChat").SessionChat} view
 * renders, wired from the chat socket, the roster and resource REST reads, and
 * the tab state. Kept out of the component so the view is markup over a model,
 * not a socket-and-query orchestrator.
 */
export function useSessionChatModel(sessionId: string) {
  const {
    messagesFor,
    subagents,
    primaryConversationId,
    conversationForAgent,
    triggers,
    artifacts,
    pinnedPaths,
    pinArtifact,
    unpinArtifact,
    connected,
    memorySuggestions,
    confirmMemory,
    dismissMemory,
    historyLoaded,
    agentBusy,
    isConversationBusy,
    getActivity,
    isMessageStreaming,
    currentAuthorId,
    send,
    abort,
    getAgentModel,
    setAgentModel,
    dismissSubagent,
  } = useSessionChat(sessionId);

  const primeModel = getAgentModel(PI_AGENT.id);

  // The bundle this session was created from (if any) drives both the
  // `tangent-ui:` message tokens and the composer's panel launcher.
  const { data: session } = useSession(sessionId);
  const bundleId = session?.config?.id;

  // Opened tabs (assets and sub-agent threads), each shown beside the chat in
  // its own closeable tab.
  const { tabs, activeTab, setActiveTab, openAsset, openAgent, closeAsset } =
    useAssetTabs(sessionId);

  const assets = buildAssets({ sessionId, artifacts, triggers });

  // The Chat tab stands in for Prime's card, so map it back to Prime's id when
  // deciding which agent card reads as selected.
  const selectedAgentId =
    activeTab === CHAT_TAB_VALUE ? PI_AGENT.id : activeTab;

  // The Conversation currently in view — the roster's mute toggle acts on a
  // participant's Membership there, and the Resources panel surfaces for it.
  const activeConversationId = conversationForAgent(selectedAgentId);

  const {
    data: participants = [],
    isPending: participantsPending,
    isError: participantsError,
  } = useSessionParticipants(sessionId);
  const { mutate: muteMembership, isPending: isTogglingMute } =
    useMuteMembership(sessionId);

  // Scope the catalog to the current human when they are an invited Participant,
  // so surfacing consults their per-Conversation grants (default-permissive with
  // none). The session owner isn't a Participant and keeps the whole catalog.
  const currentParticipant = participants.find(
    (p) => p.id === currentAuthorId && !p.revokedAt,
  );
  const resourceScope = currentParticipant
    ? {
        conversationId: activeConversationId,
        participantId: currentParticipant.id,
      }
    : undefined;

  const {
    data: resources = [],
    isPending: resourcesPending,
    isError: resourcesError,
  } = useSessionResources(sessionId, resourceScope);

  const agents = buildAgents(subagents);

  // Who a composer can @mention: Prime, the sub-agent roster, and invited
  // humans. The server re-resolves names to ids at write time.
  const mentionCandidates = buildMentionCandidates(subagents, participants);

  // Prime's card selects the fixed Chat tab; sub-agent cards open (or focus) a
  // closeable tab.
  const openAgentTab = (agent: Agent) => {
    if (agent.kind === "prime") {
      setActiveTab(CHAT_TAB_VALUE);
      return;
    }
    openAgent({ id: agent.id, name: agent.name });
  };

  const primeMessages = messagesFor(primaryConversationId);

  const busySubagents = subagents
    .filter((s) => isConversationBusy(s.conversationId))
    .map((s) => ({ id: s.id, name: s.name, conversationId: s.conversationId }));
  const armedTriggers = triggers.filter((t) => t.enabled);

  // Opening an artifact from a chat chip mirrors opening it from the sidebar: a
  // viewable "page" asset keyed by its resolved URL, so both dedupe to one tab.
  const openArtifactTab = (url: string, title: string) => {
    openAsset({
      kind: isViewableArtifact(url) ? "page" : "file",
      id: url,
      title,
      url,
      path: url,
    });
  };

  // Opening a viewable resource resolves its workspace-relative uri to the file
  // API url and reuses the artifact tab, so a catalogued file opens the same way
  // a pinned artifact does.
  const openResourceTab = (resource: Resource) => {
    const base = apiUrl(`/api/sessions/${sessionId}/files`);
    const url = resolveUrl(resource.uri, base) ?? resource.uri;
    openArtifactTab(url, resource.name);
  };

  // Pin an artifact if it isn't already pinned, else unpin it. Both the chip and
  // the sidebar list update via the `artifacts.update` directive once confirmed.
  const togglePinArtifact = (path: string, title: string) => {
    if (pinnedPaths.has(path)) unpinArtifact(path);
    else pinArtifact(path, title);
  };

  // The chat state every opened asset tab's body shares; forwarded as-is so
  // AssetTabContent can resolve and render the right per-kind view.
  const sharedTabProps = {
    sessionId,
    subagents,
    conversationForAgent,
    primaryConversationId,
    triggers,
    messagesFor,
    currentAuthorId,
    bundleId,
    connected,
    historyLoaded,
    pinnedPaths,
    getActivity,
    isConversationBusy,
    isMessageStreaming,
    getAgentModel,
    setAgentModel,
    abort,
    dismissSubagent,
    closeAsset,
    send,
    openArtifactTab,
    togglePinArtifact,
    mentionCandidates,
  };

  const windowsValue: SessionChatWindowsValue = {
    sessionId,
    agents,
    selectedAgentId,
    activeTab,
    assets,
    resources,
    resourcesPending,
    resourcesError,
    participants,
    participantsPending,
    participantsError,
    activeConversationId,
    currentUserId: currentAuthorId,
    onToggleMuteParticipant: (participantId, conversationId, muted) =>
      muteMembership({ participantId, conversationId, muted }),
    isTogglingMute,
    onOpenAgent: openAgentTab,
    onRemoveAgent: (agent) => {
      dismissSubagent(agent.id);
      closeAsset(agent.id);
    },
    onOpenAsset: openAsset,
    onUnpinArtifact: unpinArtifact,
    onOpenResource: openResourceTab,
  };

  const primeChatPanelProps = {
    sessionId,
    primaryConversationId,
    messages: primeMessages,
    currentAuthorId,
    bundleId,
    connected,
    historyLoaded,
    agentBusy,
    activity: getActivity(primaryConversationId),
    isMessageStreaming,
    memorySuggestions,
    confirmMemory,
    dismissMemory,
    busySubagents,
    armedTriggers,
    subagents,
    assets,
    primeModel,
    send,
    abort,
    openAgent,
    openAsset,
    setAgentModel,
    openArtifactTab,
    pinnedPaths,
    togglePinArtifact,
    mentionCandidates,
  };

  return {
    session,
    connected,
    tabs,
    activeTab,
    setActiveTab,
    closeAsset,
    subagents,
    windowsValue,
    primeChatPanelProps,
    sharedTabProps,
  };
}
