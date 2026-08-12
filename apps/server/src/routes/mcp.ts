import { type Request, type Response, Router } from "express";

import { type DeliverToPrime, dispatchMcp } from "../mcp/mcpRelayServer.ts";
import type { RelayChannel, RelayRegistry } from "../mcp/relayRegistry.ts";

/**
 * Public MCP endpoint an external client (dialed by the gateway) uses to relay
 * tool calls to a channel's session Prime. There is no global auth on `/api/*`;
 * each channel is gated by the per-channel bearer secret embedded in the URL it
 * was handed, mirroring the trigger-callback-secret pattern. Generic and
 * domain-agnostic — the bundle that opened the channel owns everything specific
 * to the remote runtime.
 */
export function createMcpRelayRouter(
  registry: RelayRegistry,
  deliverToPrime: DeliverToPrime,
): Router {
  const router = Router();
  // Some MCP clients probe with GET for a server-sent-events channel. This PoC
  // answers request/response over POST only, so GET is just a liveness probe.
  router.get("/:channelId", (req, res) => handleGet(registry, req, res));
  router.post("/:channelId", (req, res) =>
    handlePost(registry, deliverToPrime, req, res),
  );
  return router;
}

function handleGet(registry: RelayRegistry, req: Request, res: Response): void {
  const channelId = String(req.params.channelId);
  const channel = registry.get(channelId);
  const isAuthed = channel ? authorized(req, channel) : false;
  logDial("GET", channelId, req, isAuthed, channel !== undefined);
  if (!channel || !isAuthed) {
    res.status(channel ? 401 : 404).end();
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(": ok\n\n");
  res.end();
}

async function handlePost(
  registry: RelayRegistry,
  deliverToPrime: DeliverToPrime,
  req: Request,
  res: Response,
): Promise<void> {
  const channelId = String(req.params.channelId);
  const channel = registry.get(channelId);
  const isAuthed = channel ? authorized(req, channel) : false;
  logDial("POST", channelId, req, isAuthed, channel !== undefined);
  if (!channel) {
    res.status(404).json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "unknown channel" },
    });
    return;
  }
  if (!isAuthed) {
    res.status(401).json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "unauthorized" },
    });
    return;
  }

  const response = await dispatchMcp(
    registry,
    channel,
    req.body ?? {},
    deliverToPrime,
  );
  if (response === null) {
    console.error(`[mcp-relay] ${channelId} -> 202 (notification)`);
    res.status(202).end();
    return;
  }
  res.json(response);
}

function authorized(req: Request, channel: RelayChannel): boolean {
  return channel.credential.verify({
    authorization: req.get("authorization"),
  });
}

/**
 * Logs an inbound dial from the external MCP client (the gateway). This is the
 * only window we have into whether the gateway reaches us and what MCP framing
 * it uses, so it records the JSON-RPC method plus the transport-shaping headers
 * (Accept / Content-Type / Mcp-Session-Id) without ever printing the secret.
 */
function logDial(
  verb: string,
  channelId: string,
  req: Request,
  isAuthed: boolean,
  channelKnown: boolean,
): void {
  const body = (req.body ?? {}) as { method?: unknown; id?: unknown };
  console.error(
    `[mcp-relay] ${verb} /api/mcp/${channelId} ` +
      `method=${rpcMethod(body, verb)} id=${JSON.stringify(body.id ?? null)} ` +
      `channel=${channelKnown ? "known" : "UNKNOWN"} ` +
      `auth=${isAuthed ? "ok" : "FAIL"} ` +
      `accept=${hdr(req, "accept")} ct=${hdr(req, "content-type")} ` +
      `mcp-session-id=${hdr(req, "mcp-session-id")} ua=${hdr(req, "user-agent")}`,
  );
}

function rpcMethod(body: { method?: unknown }, verb: string): string {
  if (typeof body.method === "string") return body.method;
  return verb === "POST" ? "?" : "-";
}

function hdr(req: Request, name: string): string {
  return req.get(name) ?? "-";
}
