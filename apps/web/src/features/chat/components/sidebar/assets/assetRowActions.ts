import type { Trigger } from "@tangent/shared/contracts";

import type { Asset } from "@/features/chat/model/assets";
import type { ListItemAction } from "@/shared/ui/patterns/list-item";

interface AssetRowActionHandlers {
  /** Whether a trigger mutation is in flight (disables trigger actions). */
  triggerBusy: boolean;
  /** Unpins an artifact by its workspace-relative path. */
  onUnpin: (path: string) => void;
  /** Toggles a trigger's enabled state. */
  onToggleTrigger: (trigger: Trigger) => void;
  /** Copies a callback trigger's URL to the clipboard. */
  onCopyCallback: (trigger: Trigger) => void;
  /** Deletes a trigger. */
  onDeleteTrigger: (trigger: Trigger) => void;
}

/**
 * Hover actions for an asset card: remove (unpin) for artifacts, or
 * enable/disable, copy callback URL, and delete for triggers. Removing only
 * takes an artifact off the list; the file stays in the workspace.
 */
export function assetRowActions(
  asset: Asset,
  handlers: AssetRowActionHandlers,
): ListItemAction[] {
  if (asset.kind !== "trigger") {
    return [
      {
        icon: "X",
        label: `Remove ${asset.title}`,
        onClick: () => handlers.onUnpin(asset.path),
      },
    ];
  }

  const { trigger } = asset;
  const actions: ListItemAction[] = [
    {
      icon: "Power",
      label: trigger.enabled ? "Disable trigger" : "Enable trigger",
      tone: trigger.enabled ? "success" : "default",
      disabled: handlers.triggerBusy,
      onClick: () => handlers.onToggleTrigger(trigger),
    },
  ];
  if (trigger.kind === "callback" && trigger.callbackPath) {
    actions.push({
      icon: "Copy",
      label: "Copy callback URL",
      onClick: () => handlers.onCopyCallback(trigger),
    });
  }
  actions.push({
    icon: "Trash2",
    label: "Delete trigger",
    tone: "critical",
    disabled: handlers.triggerBusy,
    onClick: () => handlers.onDeleteTrigger(trigger),
  });
  return actions;
}
