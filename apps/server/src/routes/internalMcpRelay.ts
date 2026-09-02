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

function handleClose(
  registry: RelayRegistry,
  channelId: string,
  res: Response,
): void {
  res.json({ closed: registry.close(channelId) });
}

/**
 * Internal API used by a bundle extension (running inside a Pi process) to open
 * and close a generic MCP relay channel bound to its session. Guarded by the
 * same bearer token as the other internal APIs. Aquifer-agnostic: the extension
 * owns the remote runtime; the server only relays to the session's Prime.
 *
 * A peer's `ask_prime` no longer has a poll/answer pair here: a question is a
 * Message carrying a `correlationId`, and its answer is a Message whose
 * `inReplyTo` names it, so request/reply lives on the envelope rather than in a
 * per-channel table.
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

  router.post("/:channelId/close", (req: Request, res: Response) =>
    handleClose(registry, String(req.params.channelId), res),
  );

  return router;
}
