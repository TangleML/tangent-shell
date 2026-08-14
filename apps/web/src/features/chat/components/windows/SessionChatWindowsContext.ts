import type { Resource } from "@tangent/shared/contracts";
import { createContext, useContext } from "react";

import type { Agent } from "@/features/chat/model/agents";
import type { Asset } from "@/features/chat/model/assets";

/**
 * Live SessionChat state shared with the dockable window content. Window content
 * is captured once when a window opens (stored in a non-observable map), so the
 * Session/Agents/Assets windows must read their data from this context to stay
 * in sync with the chat rather than from props frozen at open time.
 */
export interface SessionChatWindowsValue {
  sessionId: string;
  agents: Agent[];
  selectedAgentId: string | null;
  activeTab: string;
  assets: Asset[];
  /** The session's catalogued content, surfaced read-only in the Resources panel. */
  resources: Resource[];
  onOpenAgent: (agent: Agent) => void;
  onRemoveAgent: (agent: Agent) => void;
  onOpenAsset: (asset: Asset) => void;
  onUnpinArtifact: (path: string) => void;
  /** Opens a viewable (`file`/`artifact`) resource in its own tab. */
  onOpenResource: (resource: Resource) => void;
}

export const SessionChatWindowsContext = createContext<
  SessionChatWindowsValue | undefined
>(undefined);

export function useSessionChatWindowsContext(): SessionChatWindowsValue {
  const value = useContext(SessionChatWindowsContext);
  if (!value) {
    throw new Error(
      "useSessionChatWindowsContext must be used within a SessionChatWindowsContext provider",
    );
  }
  return value;
}
