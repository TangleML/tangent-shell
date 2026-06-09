import { PI_AGENT } from "@shared/contracts.ts";
import {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from "express";

import { INTERNAL_TOKEN } from "../config.ts";
import type { PiAgentManager } from "../pi/piAgentManager.ts";
import type { SessionStore } from "../store/sessionStore.ts";

interface SpawnBody {
  sessionId?: string;
  name?: string;
  template?: string;
  systemPrompt?: string;
  tools?: string[];
  task?: string;
}

interface MessageBody {
  sessionId?: string;
  agentId?: string;
  text?: string;
}

interface KillBody {
  sessionId?: string;
  agentId?: string;
  completed?: boolean;
}

interface ReportBody {
  sessionId?: string;
  agentId?: string;
  text?: string;
}

/** Default and maximum number of transcript messages `read_room` returns. */
const DEFAULT_ROOM_LIMIT = 30;
const MAX_ROOM_LIMIT = 200;

/**
 * Internal API used only by the orchestrator extension running inside each Pi
 * process. It lets Prime spawn/message/kill/list sub-agents and lets any agent
 * read the shared transcript. Guarded by a bearer token shared with the
 * spawned processes via env, so arbitrary local callers can't drive agents.
 */
export function createInternalAgentsRouter(
  store: SessionStore,
  pi: PiAgentManager,
): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    const header = req.get("authorization");
    if (header !== `Bearer ${INTERNAL_TOKEN}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  router.post("/spawn", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as SpawnBody;
    if (!body.sessionId || !body.name) {
      res.status(400).json({ error: "sessionId and name are required" });
      return;
    }
    try {
      const subagent = pi.spawnSubagent(body.sessionId, {
        name: body.name,
        template: body.template,
        systemPrompt: body.systemPrompt,
        tools: body.tools,
        task: body.task,
      });
      res.json({ subagent });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post("/message", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as MessageBody;
    if (!body.sessionId || !body.agentId || !body.text) {
      res
        .status(400)
        .json({ error: "sessionId, agentId, and text are required" });
      return;
    }
    // Surface the directive in the sub-agent's transcript, attributed to Prime
    // (message_subagent is always a Prime-issued directive).
    pi.sendToAgent(body.sessionId, body.agentId, body.text, PI_AGENT);
    res.json({ ok: true });
  });

  router.post("/report", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as ReportBody;
    if (!body.sessionId || !body.agentId || !body.text) {
      res
        .status(400)
        .json({ error: "sessionId, agentId, and text are required" });
      return;
    }
    // Surface the report in the sub-agent's own thread and deliver it to Prime
    // so it can react immediately (message_prime is a sub-agent-issued update).
    pi.reportToPrime(body.sessionId, body.agentId, body.text);
    res.json({ ok: true });
  });

  router.post("/kill", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as KillBody;
    if (!body.sessionId || !body.agentId) {
      res.status(400).json({ error: "sessionId and agentId are required" });
      return;
    }
    pi.killAgent(body.sessionId, body.agentId, body.completed ?? false);
    res.json({ ok: true });
  });

  router.get("/list", (req: Request, res: Response) => {
    const sessionId = req.query.sessionId;
    if (typeof sessionId !== "string") {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }
    res.json({ subagents: pi.listSubagents(sessionId) });
  });

  router.get("/room", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId;
    if (typeof sessionId !== "string") {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    const requested = Number(req.query.limit);
    const limit =
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested, MAX_ROOM_LIMIT)
        : DEFAULT_ROOM_LIMIT;

    const all = await store.getMessages(sessionId);
    res.json({ messages: all.slice(-limit) });
  });

  return router;
}
