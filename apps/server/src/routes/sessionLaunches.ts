import type {
  LaunchSessionRequest,
  LaunchSessionResponse,
} from "@tangent/shared/contracts.ts";
import { Router } from "express";
import { z } from "zod";

import { getValidated, validate } from "../middleware/validate.ts";
import type { PiAgentManager } from "../pi/piAgentManager.ts";
import type { TriggerEngine } from "../pi/triggers/triggerEngine.ts";
import type { AgentBundleStore } from "../store/agentBundleStore.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import {
  provisionSession,
  SessionProvisioningError,
} from "./sessions/provisionSession.ts";

const launchSessionSchema = z
  .object({
    bundleId: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
  })
  .strict();

interface SessionLaunchDependencies {
  store: Pick<
    SessionStore,
    "createSession" | "attachConfig" | "appendMessage" | "deleteSession"
  >;
  pi: Pick<PiAgentManager, "ensure" | "prompt" | "dispose">;
  triggerEngine: Pick<TriggerEngine, "seed" | "dispose">;
  agentBundleStore: Pick<AgentBundleStore, "readBundle">;
}

export function createSessionLaunchesRouter(
  dependencies: SessionLaunchDependencies,
): Router {
  const router = Router();
  router.post(
    "/",
    validate({ body: launchSessionSchema }),
    async (req, res) => {
      const input = getValidated<LaunchSessionRequest>(req).body;

      try {
        const session = await provisionSession(dependencies, input);
        const response: LaunchSessionResponse = { sessionId: session.id };
        res.status(201).json(response);
      } catch (error) {
        if (error instanceof SessionProvisioningError) {
          res.status(error.status).json({ error: error.message });
          return;
        }
        throw error;
      }
    },
  );
  return router;
}
