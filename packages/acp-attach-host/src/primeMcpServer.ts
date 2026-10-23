import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/** The MCP revision this server speaks when a client offers no supported one. */
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

/** The single tool the attached agent uses to reach Prime proactively. */
const TOOLS = [
  {
    name: "message_prime",
    description:
      "Send a message to Prime, the Tangent session's orchestrator, at any " +
      "time — a proactive update, a blocker, or a question. A reply to a task " +
      "Prime delegated already reaches it as your turn's output; use this when " +
      "you are not answering a delegated turn.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The message to deliver to Prime.",
        },
      },
      required: ["text"],
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

export interface PrimeMcpServerOptions {
  /** The bridge's loopback host API base url (no trailing slash needed). */
  hostApiUrl: string;
  /** Bearer token guarding the loopback host API. */
  hostApiToken: string;
  input?: Readable;
  output?: Writable;
}

/**
 * A minimal MCP server over newline-delimited JSON-RPC on stdio, exposing the
 * `message_prime` tool. The attached ACP agent launches it as an MCP server;
 * the call forwards to the bridge's loopback host API, which carries it to the
 * Tangent session under the bridge's live (refreshing) attach token.
 */
export function runPrimeMcpServer(options: PrimeMcpServerOptions): void {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const reader = createInterface({ input });
  reader.on("line", (line) => void handleLine(line.trim(), options, output));
}

async function handleLine(
  line: string,
  options: PrimeMcpServerOptions,
  output: Writable,
): Promise<void> {
  if (!line) return;
  const parsed = parse(line);
  if (!parsed) return;
  if (parsed.id === undefined || parsed.id === null) return;
  const result = await dispatch(parsed, options);
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
  options: PrimeMcpServerOptions,
): Promise<unknown> {
  const id = message.id ?? null;
  if (message.method === "initialize") return ok(id, initialize(message));
  if (message.method === "tools/list") return ok(id, { tools: TOOLS });
  if (message.method === "ping") return ok(id, {});
  if (message.method === "tools/call") {
    return ok(id, await callTool(message.params, options));
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
    serverInfo: { name: "tangent-prime", version: "0.0.1" },
  };
}

async function callTool(
  params: Record<string, unknown> | undefined,
  options: PrimeMcpServerOptions,
): Promise<ToolResult> {
  const name = typeof params?.name === "string" ? params.name : "";
  if (name !== "message_prime") return text(`Unknown tool: ${name}`, true);
  const args = (params?.arguments as Record<string, unknown>) ?? {};
  return messagePrime(args, options);
}

async function messagePrime(
  args: Record<string, unknown>,
  options: PrimeMcpServerOptions,
): Promise<ToolResult> {
  const value = typeof args.text === "string" ? args.text : "";
  if (!value) return text("message_prime requires a non-empty text.", true);
  try {
    await callHostApi(options, "report", { text: value });
    return text("Delivered to Prime.");
  } catch (err) {
    return text(message(err), true);
  }
}

/** POSTs to one loopback host API route, unwrapping its `{ ok, result }` ack. */
async function callHostApi(
  options: PrimeMcpServerOptions,
  route: string,
  payload: unknown,
): Promise<unknown> {
  const url = options.hostApiUrl.replace(/\/+$/, "");
  if (!url) throw new Error("Prime is unreachable from here.");
  const response = await fetch(`${url}/${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.hostApiToken}`,
    },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: unknown;
    error?: string;
  };
  if (!response.ok || !data.ok) {
    throw new Error(
      data.error ?? `host API ${route} failed (${response.status})`,
    );
  }
  return data.result;
}

function text(value: string, isError?: boolean): ToolResult {
  return {
    content: [{ type: "text", text: value }],
    ...(isError ? { isError } : {}),
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
