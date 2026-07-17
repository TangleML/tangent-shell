import { useState } from "react";

import type { Asset } from "@/features/chat/model/assets";

/**
 * A single opened tab in the SessionChat tab strip. Carries the `kind` so
 * SessionChat can dispatch to the matching per-type TabView, plus the minimal
 * payload each view needs. Deduped (and keyed) by `id`.
 *
 * Sub-agent tabs are opened on demand (one closeable tab per sub-agent, keyed
 * by the sub-agent id); their live status/name is resolved against the roster
 * when rendered. Prime is not tracked here: it is the fixed chat tab.
 */
export type AssetTab =
  | { id: string; kind: "page" | "file"; title: string; url: string }
  | { id: string; kind: "trigger"; title: string; triggerId: string }
  | { id: string; kind: "agent"; title: string; agentId: string }
  | { id: string; kind: "pipeline-editor"; title: string };

/** The fixed, non-closeable chat tab's value (Prime's main thread). */
export const CHAT_TAB_VALUE = "chat";

/**
 * Fixed id for the singleton pipeline-editor tab. One editor tab is shared per
 * session, so opening it again just focuses the existing tab.
 */
export const PIPELINE_EDITOR_TAB_ID = "pipeline-editor";

/** Maps an {@link Asset} to the tab payload SessionChat keeps open for it. */
function toTab(asset: Asset): AssetTab {
  if (asset.kind === "trigger") {
    return {
      id: asset.id,
      kind: "trigger",
      title: asset.title,
      triggerId: asset.trigger.id,
    };
  }
  return { id: asset.id, kind: asset.kind, title: asset.title, url: asset.url };
}

/**
 * Owns the SessionChat asset tab strip: a closeable tab per opened asset (the
 * fixed chat tab and the per-sub-agent tabs are rendered separately by
 * SessionChat). Opening an already-open asset just focuses its tab; closing the
 * active tab falls back to chat.
 */
export function useAssetTabs() {
  const [tabs, setTabs] = useState<AssetTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>(CHAT_TAB_VALUE);

  function openTab(tab: AssetTab) {
    setTabs((prev) =>
      prev.some((existing) => existing.id === tab.id) ? prev : [...prev, tab],
    );
    setActiveTab(tab.id);
  }

  function openAsset(asset: Asset) {
    openTab(toTab(asset));
  }

  /**
   * Opens (or focuses) a sub-agent's thread tab. Keyed by the sub-agent id so
   * reopening the same agent just focuses its existing tab.
   */
  function openAgent(agent: { id: string; name: string }) {
    openTab({
      id: agent.id,
      kind: "agent",
      title: agent.name,
      agentId: agent.id,
    });
  }

  /**
   * Opens (or focuses) the session's singleton pipeline-editor tab — a
   * full-screen surface embedding the Tangle editor that Prime drives over CSOM.
   */
  function openPipelineEditor(title?: string) {
    openTab({
      id: PIPELINE_EDITOR_TAB_ID,
      kind: "pipeline-editor",
      title: title?.trim() || "Pipeline Editor",
    });
  }

  function closeAsset(id: string) {
    setTabs((prev) => prev.filter((tab) => tab.id !== id));
    setActiveTab((prev) => (prev === id ? CHAT_TAB_VALUE : prev));
  }

  return {
    tabs,
    activeTab,
    setActiveTab,
    openAsset,
    openAgent,
    openPipelineEditor,
    closeAsset,
  };
}
