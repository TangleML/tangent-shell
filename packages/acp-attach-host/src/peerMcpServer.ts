import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { peerSend, peerWait } from "./peerSocket.ts";

/** The MCP revision this server speaks when a client offers no supported one. */
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_WAIT_MS = 300_000;

/** The two tools the attached agent uses to talk back to its launcher. */
const TOOLS = [
  {
    name: "peer_send",
    description:
      "Send a message to the launcher agent that attached you (your peer). Use this to answer a message you received, or to report progress.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The message to deliver to the launcher.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "peer_wait",
    description:
      "Wait for the next message from the launcher agent. Blocks the current turn until a message arrives or the timeout elapses.",
    inputSchema: {
      type: "object",
      properties: {
        timeoutMs: {
          type: "number",
          description: "How long to wait, in milliseconds. Defaults to 300000.",
        },
      },
    },
  },
] as const;

interface JsonRpcMessage {
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface PeerMcpServerOptions {
  socketPath: string;
  input?: Readable;
  output?: Writable;
}

/**
 * A minimal MCP server over newline-delimited JSON-RPC on stdio, exposing
 * `peer_send` and `peer_wait`. The attached ACP agent launches it as an MCP
 * server, so its model can reach the launcher through the same mailbox socket.
 */
export function runPeerMcpServer(options: PeerMcpServerOptions): void {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const reader = createInterface({ input });
  reader.on(
    "line",
    (line) => void handleLine(line.trim(), options.socketPath, output),
  );
}

async function handleLine(
  line: string,
  socketPath: string,
  output: Writable,
): Promise<void> {
  if (!line) return;
  const parsed = parse(line);
  if (!parsed) return;
  if (parsed.id === undefined || parsed.id === null) return;
  const result = await dispatch(parsed, socketPath);
  output.write(`${JSON.stringify(result)}\n`);
}

function parse(line: string): JsonRpcMessage | undefined {
  try {
    return JSON.parse(line) as JsonRpcMessage;
  } catch {
    return undefined;
  }
}

async function dispatch(
  message: JsonRpcMessage,
  socketPath: string,
): Promise<unknown> {
  const id = message.id ?? null;
  if (message.method === "initialize") return ok(id, initialize(message));
  if (message.method === "tools/list") return ok(id, { tools: TOOLS });
  if (message.method === "ping") return ok(id, {});
  if (message.method === "tools/call") {
    return ok(id, await callTool(message.params, socketPath));
  }
  return fail(id, -32601, `Method not found: ${String(message.method)}`);
}

function initialize(message: JsonRpcMessage): unknown {
  const requested = message.params?.protocolVersion;
  const protocolVersion =
    typeof requested === "string" ? requested : DEFAULT_PROTOCOL_VERSION;
  return {
    protocolVersion,
    capabilities: { tools: {} },
    serverInfo: { name: "tangent-peer", version: "0.0.1" },
  };
}

async function callTool(
  params: Record<string, unknown> | undefined,
  socketPath: string,
): Promise<ToolResult> {
  const name = params?.name;
  const args = (params?.arguments as Record<string, unknown>) ?? {};
  if (name === "peer_send") return sendTool(args, socketPath);
  if (name === "peer_wait") return waitTool(args, socketPath);
  return text(`Unknown tool: ${String(name)}`, true);
}

async function sendTool(
  args: Record<string, unknown>,
  socketPath: string,
): Promise<ToolResult> {
  const value = typeof args.text === "string" ? args.text : "";
  if (!value) return text("peer_send requires a non-empty text.", true);
  const delivered = await peerSend(socketPath, "agent", value).catch(
    () => false,
  );
  return delivered
    ? text("Delivered to the launcher.")
    : text("The launcher is not reachable.", true);
}

async function waitTool(
  args: Record<string, unknown>,
  socketPath: string,
): Promise<ToolResult> {
  const timeoutMs =
    typeof args.timeoutMs === "number" ? args.timeoutMs : DEFAULT_WAIT_MS;
  const message = await peerWait(socketPath, "parent", timeoutMs).catch(
    () => undefined,
  );
  return message
    ? text(message.text)
    : text("No message from the launcher within the wait window.");
}

function text(value: string, isError?: boolean): ToolResult {
  return {
    content: [{ type: "text", text: value }],
    ...(isError ? { isError } : {}),
  };
}

function ok(id: number | string | null, result: unknown): unknown {
  return { jsonrpc: "2.0", id, result };
}

function fail(
  id: number | string | null,
  code: number,
  messageText: string,
): unknown {
  return { jsonrpc: "2.0", id, error: { code, message: messageText } };
}
