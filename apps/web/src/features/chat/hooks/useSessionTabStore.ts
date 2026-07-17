import type { AssetTab } from "@/features/chat/hooks/useAssetTabs";

export type SessionTabState = { tabs: AssetTab[]; activeTab: string };

export interface SessionTabStore {
  read: (sessionId: string) => SessionTabState | undefined;
  write: (sessionId: string, state: SessionTabState) => void;
}

// Default backend: in-memory, so per-session tabs survive session switches but
// are forgotten on reload. Swap this out (sessionStorage/localStorage/server)
// without touching callers.
const memoryStore = new Map<string, SessionTabState>();

const store: SessionTabStore = {
  read: (sessionId) => memoryStore.get(sessionId),
  write: (sessionId, state) => {
    memoryStore.set(sessionId, state);
  },
};

export function useSessionTabStore(): SessionTabStore {
  return store;
}
