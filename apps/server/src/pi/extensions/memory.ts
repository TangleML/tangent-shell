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
 * It registers the dispatcher-backed memory tools (`read_memory`, `remember`,
 * `suggest_memory`) whose `execute` is a thin client over this server's internal
 * `/internal/memory/call` endpoint — the server owns the files, resolves which
 * backend handles each call, and emits the "remembered" highlight from the
 * actual write. Which tools an agent may actually use is decided server-side by
 * the spawn's `--tools` allowlist (dynamic, per resolved memory), not here.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SESSION_ID = process.env.TANGENT_SESSION_ID ?? "";
const INTERNAL_URL = process.env.TANGENT_INTERNAL_URL ?? "";
const INTERNAL_TOKEN = process.env.TANGENT_INTERNAL_TOKEN ?? "";

/** Invokes one dispatcher memory tool on the server and returns its text. */
async function callMemory(
  name: string,
  params: Record<string, unknown>,
): Promise<string> {
  const response = await fetch(`${INTERNAL_URL}/internal/memory/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${INTERNAL_TOKEN}`,
    },
    body: JSON.stringify({ sessionId: SESSION_ID, name, params }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `internal API memory/call (${name}) failed (${response.status}): ${text}`,
    );
  }
  const data = (await response.json()) as { text: string };
  return data.text;
}

function textResult(text: string) {
  return { content: [{ type: "text", text }], details: {} };
}

export default function (pi: ExtensionAPI) {
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
      return textResult(await callMemory("read_memory", {}));
    },
  });

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
    promptSnippet:
      "Store a fact in session (or, on explicit request, global) memory",
    parameters: Type.Object({
      text: Type.String({
        description: "The fact to store, as a concise markdown line or block.",
      }),
      scope: Type.Optional(
        Type.Union([Type.Literal("session"), Type.Literal("global")], {
          description:
            "'session' (default) or 'global' (explicit request only).",
        }),
      ),
      replaces: Type.Optional(
        Type.String({
          description: "Exact existing text to replace, when revising a fact.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      return textResult(await callMemory("remember", params));
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
      return textResult(await callMemory("suggest_memory", params));
    },
  });
}
