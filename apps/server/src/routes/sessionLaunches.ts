import type {
  LaunchSessionRequest,
  LaunchSessionResponse,
} from "@tangent/shared/contracts.ts";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { resolveUserIdentity } from "../auth/identity.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import {
  AgentBundleNotFoundError,
  InvalidAgentBundleError,
  type SessionProvisioner,
} from "./sessions/sessionProvisioner.ts";

export const launchSessionSchema = z
  .object({
    bundleId: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
  })
  .strict();

async function handleLaunchSession(
  provisioner: SessionProvisioner,
  req: Request,
  res: Response,
): Promise<void> {
  const input = getValidated<LaunchSessionRequest>(req).body;

  try {
    const session = await provisioner.create({
      ...input,
      user: resolveUserIdentity(req.headers.cookie) ?? undefined,
    });
    const response: LaunchSessionResponse = {
      sessionId: session.id,
    };
    res.status(201).json(response);
  } catch (error) {
    if (error instanceof AgentBundleNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof InvalidAgentBundleError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
}

export function createSessionLaunchesRouter(
  provisioner: SessionProvisioner,
): Router {
  const router = Router();
  router.post(
    "/",
    validate({ body: launchSessionSchema }),
    (req: Request, res: Response) => handleLaunchSession(provisioner, req, res),
  );
  return router;
}
