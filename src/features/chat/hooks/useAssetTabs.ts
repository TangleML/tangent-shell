import { useState } from "react";

import type { Asset } from "@/features/chat/model/assets";

/**
 * A single opened asset tab in the SessionChat tab strip. Carries the asset
 * `kind` so SessionChat can dispatch to the matching per-type TabView, plus the
 * minimal payload each view needs. Deduped (and keyed) by the asset's `id`.
 *
 * Sub-agent tabs are not tracked here: they are driven directly by the live
 * sub-agent roster (one persistent tab per sub-agent), not opened on demand.
 */
export type AssetTab =
  | { id: string; kind: "page" | "file"; title: string; url: string }
  | { id: string; kind: "trigger"; title: string; triggerId: string };

/** The fixed, non-closeable chat tab's value (Prime's main thread). */
export const CHAT_TAB_VALUE = "chat";

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

  function openAsset(asset: Asset) {
    const tab = toTab(asset);
    setTabs((prev) =>
      prev.some((existing) => existing.id === tab.id) ? prev : [...prev, tab],
    );
    setActiveTab(tab.id);
  }

  function closeAsset(id: string) {
    setTabs((prev) => prev.filter((tab) => tab.id !== id));
    setActiveTab((prev) => (prev === id ? CHAT_TAB_VALUE : prev));
  }

  return { tabs, activeTab, setActiveTab, openAsset, closeAsset };
}
