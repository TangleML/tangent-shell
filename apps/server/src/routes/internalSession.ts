import { type Request, type Response, Router } from "express";
import { z } from "zod";

import type { QuestionRegistry } from "../conversation/questions.ts";
import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import {
  pinAndBroadcast,
  unpinAndBroadcast,
} from "../sockets/chatArtifacts.ts";
import {
  dismissSubagent,
  type SubagentDismissedEmitter,
  type UiCommandEmitter,
} from "../sockets/sessionRoster.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import { mountSessionRecallRoutes } from "./internalSessionRecall.ts";
import { loadSession } from "./sessions/utils.ts";

/** Rename body: a non-empty trimmed `name` applied to the given session. */
export const renameSchema = z.object({
  sessionId: z.string(),
  name: z.string().trim().min(1),
});
export type RenameInput = z.infer<typeof renameSchema>;

/** Pin-artifact body: a workspace-relative `path` with an optional `title`. */
export const pinArtifactSchema = z.object({
  sessionId: z.string(),
  path: z.string().trim().min(1),
  title: z.string().optional(),
});
export type PinArtifactInput = z.infer<typeof pinArtifactSchema>;

/** Unpin-artifact body: the workspace-relative `path` to remove. */
export const unpinArtifactSchema = z.object({
  sessionId: z.string(),
  path: z.string().trim().min(1),
});
export type UnpinArtifactInput = z.infer<typeof unpinArtifactSchema>;

/** Dismiss-subagent body: the finished sub-agent to drop from the roster. */
export const dismissSubagentSchema = z.object({
  sessionId: z.string(),
  agentId: z.string().trim().min(1),
});
export type DismissSubagentInput = z.infer<typeof dismissSubagentSchema>;

const questionItemSchema = z.object({
  id: z.string().trim().min(1).max(40).optional(),
  header: z.string().trim().min(1),
  question: z.string().trim().min(1),
  options: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        description: z.string().trim().optional(),
      }),
    )
    .default([]),
  multiSelect: z.boolean().optional(),
});

/** Ask-question body: Prime's `ask_question` call, before semantic checks. */
export const askQuestionSchema = z.object({
  sessionId: z.string(),
  questions: z.array(questionItemSchema).min(1).max(4),
  peopleOnly: z.boolean().optional(),
  expiresInSeconds: z.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(1).max(120).optional(),
});
export type AskQuestionInput = z.infer<typeof askQuestionSchema>;

export const cancelQuestionSchema = z.object({
  sessionId: z.string(),
  questionId: z.string().trim().min(1),
});
export type CancelQuestionInput = z.infer<typeof cancelQuestionSchema>;

async function handleAskQuestion(
  store: SessionStore,
  questions: QuestionRegistry,
  body: AskQuestionInput,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, body.sessionId);
  if (!session) return;
  const outcome = await questions.ask({
    ...body,
    sessionId: session.id,
    questions: body.questions.map((item, index) => ({
      ...item,
      id: item.id ?? `q${index + 1}`,
    })),
  });
  if (!outcome.ok) {
    res.status(400).json({ error: outcome.error });
    return;
  }
  res.json(outcome);
}

async function handleCancelQuestion(
  store: SessionStore,
  questions: QuestionRegistry,
  body: CancelQuestionInput,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, body.sessionId);
  if (!session) return;
  if (!(await questions.cancel(session.id, body.questionId))) {
    res.status(404).json({ error: "No such pending question" });
    return;
  }
  res.json({ ok: true });
}

/**
 * `POST /rename`: applies a session rename and pushes the updated record to the
 * UI over the generic `ui:command` channel so the change is reflected promptly.
 */
async function handleRename(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  body: RenameInput,
  res: Response,
): Promise<void> {
  const session = await store.updateSession(body.sessionId, {
    name: body.name,
  });
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  emitUiCommand(session.id, { kind: "session.update", session });
  res.json({ session });
}

/**
 * `POST /pin-artifact`: pins an artifact (by workspace-relative path) for quick
 * access and broadcasts the updated list to the UI over the generic
 * `ui:command` channel.
 */
async function handlePinArtifact(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  body: PinArtifactInput,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, body.sessionId);
  if (!session) return;

  const artifacts = await pinAndBroadcast(store, emitUiCommand, session.id, {
    path: body.path,
    title: body.title,
  });
  res.json({ artifacts });
}

/**
 * `POST /unpin-artifact`: unpins an artifact by path and broadcasts the updated
 * list to the UI.
 */
async function handleUnpinArtifact(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  body: UnpinArtifactInput,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, body.sessionId);
  if (!session) return;

  const artifacts = await unpinAndBroadcast(
    store,
    emitUiCommand,
    session.id,
    body.path,
  );
  res.json({ artifacts });
}

/**
 * `POST /dismiss-subagent`: drops a finished sub-agent from the roster, as the
 * agents pill's remove button does, and tells the session's room. A running or
 * unknown sub-agent is refused, so the caller knows nothing changed.
 */
async function handleDismissSubagent(
  store: SessionStore,
  emitSubagentDismissed: SubagentDismissedEmitter,
  body: DismissSubagentInput,
  res: Response,
): Promise<void> {
  const session = await loadSession(store, res, body.sessionId);
  if (!session) return;

  const outcome = await dismissSubagent(
    store,
    emitSubagentDismissed,
    session.id,
    body.agentId,
  );
  if (outcome === "unknown") {
    res
      .status(404)
      .json({ error: "No such sub-agent in this session's agents list" });
    return;
  }
  if (outcome === "running") {
    res
      .status(409)
      .json({ error: "Only a finished sub-agent can be dismissed" });
    return;
  }
  res.json({ ok: true });
}

/**
 * Internal API used only by the session extension running inside each Pi
 * process. It lets Prime rename the session (e.g. to a concise,
 * conversation-derived title) and dismiss finished sub-agents, lets any agent
 * pin/unpin artifacts for quick access, and serves Prime's selector-scoped
 * cross-session recall reads; the server owns the session record and
 * broadcasts changes to the room. Guarded by the same bearer token as the
 * other internal APIs so arbitrary local callers can't mutate a session.
 */
export function createInternalSessionRouter(
  store: SessionStore,
  emitUiCommand: UiCommandEmitter,
  emitSubagentDismissed: SubagentDismissedEmitter,
  questions?: QuestionRegistry,
): Router {
  const router = Router();
  router.use(requireInternalToken);

  router.post(
    "/rename",
    validate({ body: renameSchema }),
    (req: Request, res: Response) =>
      handleRename(
        store,
        emitUiCommand,
        getValidated<RenameInput>(req).body,
        res,
      ),
  );

  router.post(
    "/pin-artifact",
    validate({ body: pinArtifactSchema }),
    (req: Request, res: Response) =>
      handlePinArtifact(
        store,
        emitUiCommand,
        getValidated<PinArtifactInput>(req).body,
        res,
      ),
  );

  router.post(
    "/unpin-artifact",
    validate({ body: unpinArtifactSchema }),
    (req: Request, res: Response) =>
      handleUnpinArtifact(
        store,
        emitUiCommand,
        getValidated<UnpinArtifactInput>(req).body,
        res,
      ),
  );

  router.post(
    "/dismiss-subagent",
    validate({ body: dismissSubagentSchema }),
    (req: Request, res: Response) =>
      handleDismissSubagent(
        store,
        emitSubagentDismissed,
        getValidated<DismissSubagentInput>(req).body,
        res,
      ),
  );

  if (questions) {
    router.post(
      "/ask-question",
      validate({ body: askQuestionSchema }),
      (req: Request, res: Response) =>
        handleAskQuestion(
          store,
          questions,
          getValidated<AskQuestionInput>(req).body,
          res,
        ),
    );
    router.post(
      "/cancel-question",
      validate({ body: cancelQuestionSchema }),
      (req: Request, res: Response) =>
        handleCancelQuestion(
          store,
          questions,
          getValidated<CancelQuestionInput>(req).body,
          res,
        ),
    );
  }

  mountSessionRecallRoutes(router, store);

  return router;
}
