// @ts-nocheck
/**
 * Remote-tools dispatcher extension loaded into every session Pi process via
 * `--extension`.
 *
 * Like the orchestrator/memory extensions, this is authored against Pi's
 * extension runtime (it imports modules Pi resolves when loading extensions,
 * e.g. `typebox`), not this repo's `node_modules`. It is excluded from our
 * type-check (`@ts-nocheck`) and never imported by the server — only passed as a
 * path to the Pi subprocess.
 *
 * A "remote tool" is a named async function hosted by a connected remote
 * environment (e.g. a browser embed) and invoked over the `/remote-env`
 * WebSocket — no second LLM, no browser sub-agent. Pi freezes its `--tools`
 * allowlist at spawn, and the host usually connects after Prime is already
 * running, so this ships a stable two-tool dispatcher instead of first-class
 * per-host tool names:
 * - `list_remote_tools` — the current catalog (changes as hosts connect/leave).
 * - `call_remote_tool` — invoke one by name with JSON arguments.
 *
 * Both are thin clients over this server's internal remote-tools API; the
 * gateway owns the socket and routes the call to the session's environment.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SESSION_ID = process.env.TANGENT_SESSION_ID ?? "";
const AGENT_ID = process.env.TANGENT_AGENT_ID ?? "";
const INTERNAL_URL = process.env.TANGENT_INTERNAL_URL ?? "";
const INTERNAL_TOKEN = process.env.TANGENT_INTERNAL_TOKEN ?? "";

async function callApi(
  method: "GET" | "POST",
  endpoint: string,
  body?: Record<string, unknown>,
  query?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${INTERNAL_URL}/internal/remote-tools/${endpoint}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${INTERNAL_TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `internal API ${endpoint} failed (${response.status}): ${text}`,
    );
  }
  return response.json();
}

function textResult(text: string) {
  return { content: [{ type: "text", text }], details: {} };
}

/** Renders one JSON-serializable tool result as readable text for the agent. */
function renderResult(value: unknown): string {
  if (value === undefined || value === null) return "(no result)";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "list_remote_tools",
    label: "List Remote Tools",
    description:
      "List the tools the connected host environment currently offers (e.g. a " +
      "browser embedding this session). The catalog is dynamic: it appears when " +
      "a host connects and is empty when none is. Call this before " +
      "call_remote_tool to see what is available and each tool's arguments.",
    promptSnippet: "List the RPC tools the connected host offers",
    parameters: Type.Object({}),
    async execute() {
      const data = (await callApi("GET", "list", undefined, {
        sessionId: SESSION_ID,
      })) as {
        tools: Array<{
          name: string;
          description: string;
          inputSchema: unknown;
        }>;
      };

      if (!data.tools.length) {
        return textResult(
          "No host environment is connected, so there are no remote tools right now.",
        );
      }
      const lines = data.tools.map(
        (tool) =>
          `- ${tool.name}: ${tool.description}\n  arguments: ${JSON.stringify(tool.inputSchema)}`,
      );
      return textResult(lines.join("\n"));
    },
  });

  pi.registerTool({
    name: "call_remote_tool",
    label: "Call Remote Tool",
    description:
      "Invoke one tool offered by the connected host environment by name, " +
      "passing its arguments as a JSON object. Call list_remote_tools first to " +
      "learn the available names and each tool's argument schema. Returns the " +
      "host's result. Fails clearly if no host is connected or the name is " +
      "unknown.",
    promptSnippet: "Invoke a host-provided remote tool by name",
    parameters: Type.Object({
      name: Type.String({
        description: "The tool name from list_remote_tools.",
      }),
      arguments: Type.Optional(
        Type.Unknown({
          description:
            "The tool's arguments as a JSON object matching its inputSchema.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const data = (await callApi("POST", "call", {
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        name: params.name,
        arguments: params.arguments ?? {},
      })) as { ok: boolean; result?: unknown; error?: string };

      if (!data.ok) {
        return textResult(
          `Remote tool "${params.name}" failed: ${data.error ?? "unknown error"}`,
        );
      }
      return textResult(renderResult(data.result));
    },
  });
}
