// @ts-nocheck
/**
 * Memory extension loaded into every session Pi process via `--extension`.
 *
 * Like the orchestrator extension, this is authored against Pi's extension
 * runtime (it imports modules Pi resolves when loading extensions, e.g.
 * `typebox`), not this repo's `node_modules`. It is excluded from our
 * type-check (`@ts-nocheck`) and never imported by the server — only passed as a
 * path to the Pi subprocess.
 *
 * Tools by role (from `TANGENT_AGENT_ROLE`):
 * - all agents: `read_memory` (read the session + global stores).
 * - `prime` only: `remember` (write directly) and `suggest_memory` (propose a
 *   change the user must confirm). Prime owns the human conversation, so it is
 *   the sole writer.
 *
 * All tools are thin clients over this server's internal memory API; the server
 * owns the files and emits the "remembered" highlight from the actual write.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SESSION_ID = process.env.TANGENT_SESSION_ID ?? "";
const ROLE = process.env.TANGENT_AGENT_ROLE ?? "subagent";
const INTERNAL_URL = process.env.TANGENT_INTERNAL_URL ?? "";
const INTERNAL_TOKEN = process.env.TANGENT_INTERNAL_TOKEN ?? "";

async function callApi(
  method: "GET" | "POST",
  endpoint: string,
  body?: Record<string, unknown>,
  query?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${INTERNAL_URL}/internal/memory/${endpoint}`);
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
    throw new Error(`internal API ${endpoint} failed (${response.status}): ${text}`);
  }
  return response.json();
}

function textResult(text: string) {
  return { content: [{ type: "text", text }], details: {} };
}

export default function (pi: ExtensionAPI) {
  // Every agent can read its memory.
  pi.registerTool({
    name: "read_memory",
    label: "Read Memory",
    description:
      "Read your current memory: the global store (applies to every session) " +
      "and the session store (this session only). Use this to ground yourself " +
      "before acting and to verify what is actually stored before claiming to " +
      "remember something.",
    promptSnippet: "Read your global + session memory",
    parameters: Type.Object({}),
    async execute() {
      const data = (await callApi("GET", "read", undefined, {
        sessionId: SESSION_ID,
      })) as { session: string; global: string };

      const session = data.session?.trim() || "(empty)";
      const global = data.global?.trim() || "(empty)";
      return textResult(
        `## Global memory\n\n${global}\n\n## Session memory\n\n${session}`,
      );
    },
  });

  if (ROLE !== "prime") return;

  // Prime-only memory-mutation tools below.
  pi.registerTool({
    name: "remember",
    label: "Remember",
    description:
      "Store a fact in memory. Use scope 'session' (default) when the user " +
      "says to remember/memorize something for this session, or when you spot " +
      "an obvious, durable improvement to how you should work here. Use scope " +
      "'global' ONLY when the user has EXPLICITLY asked you to remember it " +
      "across all sessions — otherwise use suggest_memory instead. To revise " +
      "an existing fact, pass the exact prior text in `replaces`. After it " +
      "succeeds, tell the user plainly what you stored.",
    promptSnippet: "Store a fact in session (or, on explicit request, global) memory",
    parameters: Type.Object({
      text: Type.String({
        description: "The fact to store, as a concise markdown line or block.",
      }),
      scope: Type.Optional(
        Type.Union([Type.Literal("session"), Type.Literal("global")], {
          description: "'session' (default) or 'global' (explicit request only).",
        }),
      ),
      replaces: Type.Optional(
        Type.String({
          description: "Exact existing text to replace, when revising a fact.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const data = (await callApi("POST", "remember", {
        sessionId: SESSION_ID,
        scope: params.scope ?? "session",
        text: params.text,
        replaces: params.replaces,
      })) as { stored: string; scope: string };

      return textResult(
        `Stored to ${data.scope} memory. The user has been shown a confirmation ` +
          `of exactly what was saved.`,
      );
    },
  });

  pi.registerTool({
    name: "suggest_memory",
    label: "Suggest Memory",
    description:
      "Propose remembering something WITHOUT writing it yet. Use this for " +
      "anything you think is worth remembering globally but the user did not " +
      "explicitly ask to store. The user is shown a confirm/dismiss card; only " +
      "if they confirm is it written. Do not claim it was remembered until you " +
      "are told the user confirmed.",
    promptSnippet: "Propose a memory the user must confirm before it is stored",
    parameters: Type.Object({
      text: Type.String({ description: "The fact you propose to remember." }),
      scope: Type.Optional(
        Type.Union([Type.Literal("session"), Type.Literal("global")], {
          description: "Which store to propose writing to (default 'global').",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      await callApi("POST", "suggest", {
        sessionId: SESSION_ID,
        scope: params.scope ?? "global",
        text: params.text,
      });
      return textResult(
        "Suggestion shown to the user. Awaiting their confirmation before " +
          "anything is stored; do not assume it was remembered.",
      );
    },
  });
}
