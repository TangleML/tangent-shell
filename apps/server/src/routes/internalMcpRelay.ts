import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { canIssueChannelUrl, channelUrl } from "../mcp/channelUrl.ts";
import type { RelayRegistry } from "../mcp/relayRegistry.ts";
import { requireInternalToken } from "../middleware/requireInternalToken.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { SessionStore } from "../store/sessionStore.ts";

/** Open body: bind a new channel to a session, with an optional peer label. */
export const openSchema = z.object({
  sessionId: z.string(),
  label: z.string().optional(),
});
export type OpenInput = z.infer<typeof openSchema>;

/** Answer body: resolve a pending `ask_prime` question on a channel. */
export const answerSchema = z.object({
  request_id: z.string(),
  answer: z.string(),
});
export type AnswerInput = z.infer<typeof answerSchema>;

async function handleOpen(
  registry: RelayRegistry,
  store: SessionStore,
  body: OpenInput,
  res: Response,
): Promise<void> {
  if (!canIssueChannelUrl()) {
    res.status(501).json({
      error:
        "TANGENT_PUBLIC_URL is not set. The external MCP client must dial an " +
        "HTTPS, non-loopback URL, so set TANGENT_PUBLIC_URL to this server's " +
        "public base (a tunnel in dev, the reverse-proxy URL in a real " +
        "instance) so a dial-able channel URL can be issued.",
    });
    return;
  }

  const session = await store.getSession(body.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const { channelId, secret } = registry.open({
    sessionId: body.sessionId,
    label: body.label,
  });
  const url = channelUrl(channelId);
  console.error(
    `[mcp-relay] opened channel ${channelId} for session ${body.sessionId} ` +
      `-> ${url}`,
  );
  res.json({ channelId, secret, url });
}

function handlePending(
  registry: RelayRegistry,
  channelId: string,
  res: Response,
): void {
  if (!registry.get(channelId)) {
    res.status(404).json({ error: "Unknown channel" });
    return;
  }
  res.json({ pending: registry.pending(channelId) });
}

function handleAnswer(
  registry: RelayRegistry,
  channelId: string,
  body: AnswerInput,
  res: Response,
): void {
  if (!registry.get(channelId)) {
    res.status(404).json({ error: "Unknown channel" });
    return;
  }
  const delivered = registry.answer(channelId, body.request_id, body.answer);
  res.json({ delivered });
}

function handleClose(
  registry: RelayRegistry,
  channelId: string,
  res: Response,
): void {
  res.json({ closed: registry.close(channelId) });
}

/**
 * Internal API used by a bundle extension (running inside a Pi process) to open
 * a generic MCP relay channel bound to its session, poll/answer questions the
 * remote peer raised, and close the channel. Guarded by the same bearer token
 * as the other internal APIs. Aquifer-agnostic: the extension owns the remote
 * runtime; the server only relays to the session's Prime.
 */
export function createInternalMcpRelayRouter(
  registry: RelayRegistry,
  store: SessionStore,
): Router {
  const router = Router();

  router.use(requireInternalToken);

  router.post(
    "/open",
    validate({ body: openSchema }),
    (req: Request, res: Response) =>
      handleOpen(registry, store, getValidated<OpenInput>(req).body, res),
  );

  router.get("/:channelId/pending", (req: Request, res: Response) =>
    handlePending(registry, String(req.params.channelId), res),
  );

  router.post(
    "/:channelId/answer",
    validate({ body: answerSchema }),
    (req: Request, res: Response) =>
      handleAnswer(
        registry,
        String(req.params.channelId),
        getValidated<AnswerInput>(req).body,
        res,
      ),
  );

  router.post("/:channelId/close", (req: Request, res: Response) =>
    handleClose(registry, String(req.params.channelId), res),
  );

  return router;
}
