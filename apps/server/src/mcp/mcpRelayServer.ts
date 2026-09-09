import { randomUUID } from "node:crypto";

import type { RelayChannel, RelayRegistry } from "./relayRegistry.ts";

/**
 * Generic MCP JSON-RPC handler for a single relay channel. It speaks the subset
 * of the Model Context Protocol an external client exercises when the gateway
 * dials in — `initialize`, `tools/list`, `tools/call` — and exposes two generic
 * tools that forward to the channel's session Prime. It has no knowledge of the
 * remote runtime on the other end (that lives entirely in the bundle that
 * opened the channel).
 */

/** Callback that relays a message to a session's Prime agent. */
export type DeliverToPrime = (sessionId: string, text: string) => void;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Max time `ask_prime` blocks for an answer, safely under MCP's 30s cap. */
const ASK_TIMEOUT_MS = 25_000;
const ASK_POLL_MS = 300;

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "send_to_prime",
    description:
      "Send a message back to Prime, the coordinator that started you. " +
      "Fire-and-forget: use it to report findings, progress, or blockers.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The message for Prime." },
      },
      required: ["text"],
    },
  },
  {
    name: "ask_prime",
    description:
      "Ask Prime a question and wait briefly for an answer. Blocks up to ~25s; " +
      "if Prime does not answer in time you receive a fallback and should use " +
      "your best judgment. Prefer send_to_prime when you do not need a reply.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question for Prime." },
      },
      required: ["question"],
    },
  },
];

interface Ctx {
  registry: RelayRegistry;
  channel: RelayChannel;
  message: JsonRpcRequest;
  deliverToPrime: DeliverToPrime;
  id: string | number;
}

type MethodHandler = (ctx: Ctx) => JsonRpcResponse | Promise<JsonRpcResponse>;

const HANDLERS: Record<string, MethodHandler> = {
  initialize: handleInitialize,
  "tools/list": handleToolsList,
  "tools/call": handleToolsCall,
};

/**
 * Dispatches one JSON-RPC message for `channel`. Returns the response object,
 * or `null` for notifications (which take no reply body). Unknown methods
 * return a JSON-RPC method-not-found error.
 */
export async function dispatchMcp(
  registry: RelayRegistry,
  channel: RelayChannel,
  message: JsonRpcRequest,
  deliverToPrime: DeliverToPrime,
): Promise<JsonRpcResponse | null> {
  const method = String(message.method ?? "");
  const id = message.id;

  // Notifications (e.g. notifications/initialized) carry no id and get no reply.
  if (id === undefined || id === null) return null;

  const handler = HANDLERS[method];
  if (!handler) {
    console.error(
      `[mcp-relay] ${channel.channelId} method not found: ${method} ` +
        `(raw: ${JSON.stringify(message).slice(0, 300)})`,
    );
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `method not found: ${method}` },
    };
  }
  return handler({ registry, channel, message, deliverToPrime, id });
}

function handleInitialize({ message, id }: Ctx): JsonRpcResponse {
  const requested = (message.params as { protocolVersion?: string } | undefined)
    ?.protocolVersion;
  return ok(id, {
    protocolVersion: requested ?? PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: "tangent-prime-relay", version: "0.1.0" },
  });
}

function handleToolsList({ channel, id }: Ctx): JsonRpcResponse {
  console.error(
    `[mcp-relay] ${channel.channelId} tools/list -> ` +
      `${TOOLS.map((t) => t.name).join(", ")}`,
  );
  return ok(id, { tools: TOOLS });
}

async function handleToolsCall(ctx: Ctx): Promise<JsonRpcResponse> {
  const params = (ctx.message.params ?? {}) as {
    name?: string;
    arguments?: Record<string, unknown>;
  };
  const text = await callTool(
    ctx,
    String(params.name ?? ""),
    params.arguments ?? {},
  );
  return ok(ctx.id, { content: [{ type: "text", text }] });
}

function callTool(
  ctx: Ctx,
  name: string,
  args: Record<string, unknown>,
): Promise<string> | string {
  console.error(`[mcp-relay] ${ctx.channel.channelId} tools/call name=${name}`);
  if (name === "send_to_prime") return sendToPrimeTool(ctx, args);
  if (name === "ask_prime") return askPrimeTool(ctx, args);
  return `Unknown tool: ${name}`;
}

function sendToPrimeTool(
  { channel, deliverToPrime }: Ctx,
  args: Record<string, unknown>,
): string {
  const text = String(args.text ?? "").trim();
  if (!text) return "Nothing to send (empty text).";
  deliverToPrime(
    channel.sessionId,
    `Remote agent (${channel.label}) reports:\n\n${text}`,
  );
  return "Delivered to Prime.";
}

async function askPrimeTool(
  { registry, channel, deliverToPrime }: Ctx,
  args: Record<string, unknown>,
): Promise<string> {
  const question = String(args.question ?? "").trim();
  if (!question) return "Empty question; nothing to ask.";
  const requestId = randomUUID().replace(/-/g, "").slice(0, 12);
  registry.addQuestion(channel.channelId, requestId, question);
  deliverToPrime(
    channel.sessionId,
    `Remote agent (${channel.label}) asks (request_id "${requestId}"):\n\n` +
      `${question}\n\n` +
      `Reply by supplying an answer for request_id "${requestId}".`,
  );
  const deadline = Date.now() + ASK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const answer = registry.takeAnswer(channel.channelId, requestId);
    if (answer !== undefined) return answer;
    await sleep(ASK_POLL_MS);
  }
  return (
    "Prime did not answer in time. Proceed using your best judgment and " +
    "report what you decided with send_to_prime."
  );
}

function ok(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
