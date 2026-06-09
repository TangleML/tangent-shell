import { useState } from "react";

/** A single opened "page" artifact, keyed (and deduped) by its resolved URL. */
export interface ArtifactTab {
  id: string;
  url: string;
  title: string;
}

/** The fixed, non-closeable chat tab's value. */
export const CHAT_TAB_VALUE = "chat";

/**
 * Owns the SessionChat tab strip: the fixed chat tab plus a closeable tab per
 * opened artifact. Opening an already-open artifact just focuses its tab;
 * closing the active tab falls back to chat.
 */
export function useArtifactTabs() {
  const [tabs, setTabs] = useState<ArtifactTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>(CHAT_TAB_VALUE);

  function openArtifact(url: string, title: string) {
    setTabs((prev) =>
      prev.some((tab) => tab.id === url)
        ? prev
        : [...prev, { id: url, url, title }],
    );
    setActiveTab(url);
  }

  function closeArtifact(id: string) {
    setTabs((prev) => prev.filter((tab) => tab.id !== id));
    setActiveTab((prev) => (prev === id ? CHAT_TAB_VALUE : prev));
  }

  return { tabs, activeTab, setActiveTab, openArtifact, closeArtifact };
}
