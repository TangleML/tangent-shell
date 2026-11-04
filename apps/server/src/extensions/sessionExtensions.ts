import type {
  BundleExtensionPolicy,
  ExtensionSelection,
} from "@tangent/shared/contracts.ts";

import type { GlobalExtensionService } from "./globalExtensionService.ts";
import { resolveExtensionSelection } from "./selection.ts";
import type { ExtensionSpawnPlan } from "./types.ts";

/** Synchronous read of a session's persisted global-extension selection. */
export interface SessionExtensionSelections {
  extensionsOf(sessionId: string): ExtensionSelection | undefined;
}

/**
 * The spawn-time projection the agent manager asks for each agent: the resolved
 * {@link ExtensionSpawnPlan} for a session, given the session's bundle policy.
 * Injected so the manager needs neither the store nor the service directly.
 */
export interface SessionExtensions {
  spawnPlan(
    sessionId: string,
    policy: BundleExtensionPolicy | undefined,
  ): ExtensionSpawnPlan;
}

/**
 * Wires a session's persisted selection and the installed-extension service
 * into a {@link SessionExtensions}: it layers the bundle policy over the session
 * selection ({@link resolveExtensionSelection}), expands `"all"` to the
 * currently installed ids, and returns that set's spawn plan — recomputed every
 * spawn, so a new install or an opt-in change takes effect on the next one.
 */
export function createSessionExtensions(
  service: GlobalExtensionService,
  selections: SessionExtensionSelections,
): SessionExtensions {
  return {
    spawnPlan(sessionId, policy) {
      const resolved = resolveExtensionSelection(
        policy,
        selections.extensionsOf(sessionId),
      );
      const ids = resolved === "all" ? service.readyIds() : resolved;
      return service.spawnPlan(ids);
    },
  };
}
