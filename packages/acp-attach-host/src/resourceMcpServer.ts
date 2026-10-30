import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/** The MCP revision this server speaks when a client offers no supported one. */
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

/** Matches the server's per-file resource cap (MAX_FILE_RESOURCE_BYTES). */
const MAX_FILE_BYTES = 1024 * 1024;

/**
 * The three tools the attached agent uses to contribute to and read the Tangent
 * session. Their shapes mirror the pi session-resources extension so an agent
 * sees the same surface however it was launched.
 */
const TOOLS = [
  {
    name: "put_session_resource",
    description:
      "Write a file/blob into the Tangent session so Prime and other agents " +
      "(including those on other environments) can fetch it. Pass 'content' " +
      "inline for small pieces (binary must be base64 with encoding: 'base64'), " +
      "or pass 'sourcePath' to upload a local file the tool reads itself without " +
      "inlining its bytes. Provide exactly one of content/sourcePath. The decoded " +
      "size limit is 1 MiB.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Destination path inside the session's uploads/ folder.",
        },
        content: {
          type: "string",
          description:
            "Inline file contents (text, or base64). Use for small pieces.",
        },
        sourcePath: {
          type: "string",
          description:
            "Local file path the tool reads itself (preferred for large files). " +
            "Resolved against the attached agent's working folder.",
        },
        encoding: {
          type: "string",
          enum: ["utf8", "base64"],
          description:
            "How inline content is decoded. Defaults to utf8. Ignored for sourcePath.",
        },
        name: {
          type: "string",
          description: "Catalog display name; defaults to path.",
        },
        contentType: {
          type: "string",
          description: "MIME type recorded in the catalog meta.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_session_resources",
    description:
      "List the files and resources catalogued in the Tangent session, " +
      "including those contributed by Prime and agents on other environments.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_session_resource",
    description:
      "Read a Tangent session resource's contents by its uri (e.g. " +
      "'uploads/report.csv'), including content another environment contributed.",
    inputSchema: {
      type: "object",
      properties: {
        uri: {
          type: "string",
          description: "Session-root-relative resource uri.",
        },
      },
      required: ["uri"],
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

export interface ResourceMcpServerOptions {
  /** The bridge's loopback host API base url (no trailing slash needed). */
  hostApiUrl: string;
  /** Bearer token guarding the loopback host API. */
  hostApiToken: string;
  input?: Readable;
  output?: Writable;
}

/**
 * A minimal MCP server over newline-delimited JSON-RPC on stdio, exposing the
 * session-resource tools. The attached ACP agent launches it as an MCP server;
 * each tool call forwards to the bridge's loopback host API, which carries it to
 * the Tangent session under the bridge's live (refreshing) attach token.
 */
export function runResourceMcpServer(options: ResourceMcpServerOptions): void {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const reader = createInterface({ input });
  reader.on("line", (line) => void handleLine(line.trim(), options, output));
}

async function handleLine(
  line: string,
  options: ResourceMcpServerOptions,
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
  options: ResourceMcpServerOptions,
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
    serverInfo: { name: "tangent-session-resources", version: "0.0.1" },
  };
}

type ToolHandler = (
  args: Record<string, unknown>,
  options: ResourceMcpServerOptions,
) => Promise<ToolResult>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  put_session_resource: (args, options) => putResource(args, options),
  list_session_resources: (_args, options) => listResources(options),
  read_session_resource: (args, options) => readResource(args, options),
};

async function callTool(
  params: Record<string, unknown> | undefined,
  options: ResourceMcpServerOptions,
): Promise<ToolResult> {
  const name = typeof params?.name === "string" ? params.name : "";
  const args = (params?.arguments as Record<string, unknown>) ?? {};
  const handler = TOOL_HANDLERS[name];
  if (!handler) return text(`Unknown tool: ${name}`, true);
  return handler(args, options);
}

/** The decoded content, its encoding, and the display name to fall back on. */
interface PreparedContent {
  content: string;
  encoding: "utf8" | "base64";
  defaultName: string;
}

function inlineContent(
  args: Record<string, unknown>,
  destPath: string,
): PreparedContent {
  return {
    content: typeof args.content === "string" ? args.content : "",
    encoding: args.encoding === "base64" ? "base64" : "utf8",
    defaultName: destPath,
  };
}

async function readSource(sourcePath: string): Promise<PreparedContent> {
  const absolute = resolve(process.cwd(), sourcePath);
  const bytes = await readFile(absolute);
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(
      `File is ${bytes.byteLength} bytes; the session resource limit is 1 MiB.`,
    );
  }
  return {
    content: bytes.toString("base64"),
    encoding: "base64",
    defaultName: basename(absolute),
  };
}

async function buildFileInput(
  args: Record<string, unknown>,
  destPath: string,
  sourcePath: string,
): Promise<Record<string, unknown>> {
  const prepared = sourcePath
    ? await readSource(sourcePath)
    : inlineContent(args, destPath);
  const contentType =
    typeof args.contentType === "string" ? args.contentType : undefined;
  return {
    kind: "file",
    path: destPath,
    content: prepared.content,
    encoding: prepared.encoding,
    name: typeof args.name === "string" ? args.name : prepared.defaultName,
    ...(contentType ? { meta: { contentType } } : {}),
  };
}

async function putResource(
  args: Record<string, unknown>,
  options: ResourceMcpServerOptions,
): Promise<ToolResult> {
  const destPath = typeof args.path === "string" ? args.path : "";
  if (!destPath) return text("put_session_resource requires a 'path'.", true);
  const sourcePath = typeof args.sourcePath === "string" ? args.sourcePath : "";
  if ((args.content !== undefined) === (sourcePath !== "")) {
    return text("Provide exactly one of 'content' or 'sourcePath'.", true);
  }
  try {
    const input = await buildFileInput(args, destPath, sourcePath);
    const resource = (await callHostApi(options, "put", { input })) as {
      uri: string;
    };
    return text(`Added session resource ${resource.uri}`);
  } catch (err) {
    return text(message(err), true);
  }
}

async function listResources(
  options: ResourceMcpServerOptions,
): Promise<ToolResult> {
  try {
    const resources = (await callHostApi(options, "list", {})) as Array<{
      name: string;
      uri: string;
    }>;
    return text(`## Session resources\n\n${renderList(resources)}`);
  } catch (err) {
    return text(message(err), true);
  }
}

async function readResource(
  args: Record<string, unknown>,
  options: ResourceMcpServerOptions,
): Promise<ToolResult> {
  const uri = typeof args.uri === "string" ? args.uri : "";
  if (!uri) return text("read_session_resource requires a 'uri'.", true);
  try {
    const result = (await callHostApi(options, "read", { uri })) as {
      content: string;
    };
    return text(Buffer.from(result.content, "base64").toString("utf8"));
  } catch (err) {
    return text(message(err), true);
  }
}

function renderList(resources: Array<{ name: string; uri: string }>): string {
  if (!resources || resources.length === 0) return "(no session resources)";
  return resources.map((r) => `- ${r.name} (${r.uri})`).join("\n");
}

/** POSTs to one loopback host API route, unwrapping its `{ ok, result }` ack. */
async function callHostApi(
  options: ResourceMcpServerOptions,
  route: string,
  payload: unknown,
): Promise<unknown> {
  const url = options.hostApiUrl.replace(/\/+$/, "");
  if (!url) throw new Error("Session resources are unavailable here.");
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
