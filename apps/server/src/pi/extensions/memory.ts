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
 * `suggest_memory`, and the bundle knowledge base's `kb_*` tools, which the
 * `--tools` allowlist only enables for sessions that bind `bundle-kb`) whose
 * `execute` is a thin client over this server's internal
 * `/internal/memory/call` endpoint — the server owns the files, resolves which
 * backend handles each call, and emits the "remembered" highlight from the
 * actual write. The write tools are registered for Prime only, and the spawn's
 * `--tools` allowlist and the server's role check on `/call` keep sub-agents
 * from writing through them. That role comes from the self-reported agent id,
 * so it does not isolate an agent with shell access to the internal token.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SESSION_ID = process.env.TANGENT_SESSION_ID ?? "";
const AGENT_ID = process.env.TANGENT_AGENT_ID ?? "";
const ROLE = process.env.TANGENT_AGENT_ROLE ?? "subagent";
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
    body: JSON.stringify({
      sessionId: SESSION_ID,
      agentId: AGENT_ID,
      name,
      params,
    }),
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
      "and the session store (this session only). Pass `entry` with ids from " +
      "the memory contents list to fetch just those entries. Use this to " +
      "ground yourself before acting and to verify what is actually stored " +
      "before claiming to remember something.",
    promptSnippet: "Read your global + session memory, or entries by id",
    parameters: Type.Object({
      scope: Type.Optional(
        Type.Union([Type.Literal("session"), Type.Literal("global")], {
          description: "Read only this store (default both).",
        }),
      ),
      entry: Type.Optional(
        Type.String({
          description:
            "Entry ids from the contents list, comma-separated, e.g. 'a1b2c3,d4e5f6'.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      return textResult(await callMemory("read_memory", params));
    },
  });

  pi.registerTool({
    name: "kb_search",
    label: "Search Bundle Knowledge",
    description:
      "Search the knowledge base shared by every session of this bundle. Use " +
      "it for domain knowledge about what this bundle does; use the project " +
      "or session memory tools for this session's own project. Modes: " +
      "'keyword' (default, exact terms), 'semantic' (meaning), 'deep' " +
      "(semantic plus reranking, slowest).",
    promptSnippet: "Search the bundle's shared knowledge base",
    parameters: Type.Object({
      query: Type.String({ description: "What to look for." }),
      mode: Type.Optional(
        Type.Union(
          [
            Type.Literal("keyword"),
            Type.Literal("semantic"),
            Type.Literal("deep"),
          ],
          { description: "Search mode (default 'keyword')." },
        ),
      ),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 20,
          description: "Max results (default 5).",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      return textResult(await callMemory("kb_search", params));
    },
  });

  pi.registerTool({
    name: "kb_read",
    label: "Read Bundle Knowledge",
    description:
      "Read a file from the knowledge base shared by every session of this " +
      "bundle: MEMORY.md by default, or a path such as 'daily/2026-01-31.md' " +
      "from a search result. Pass `entry` with ids from the contents list to " +
      "fetch just those MEMORY.md entries. Lists the store's files too.",
    promptSnippet:
      "Read a file or entries from the bundle's shared knowledge base",
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({
          description: "Store-relative markdown path (default MEMORY.md).",
        }),
      ),
      entry: Type.Optional(
        Type.String({
          description:
            "MEMORY.md entry ids from the contents list, comma-separated.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      return textResult(await callMemory("kb_read", params));
    },
  });

  if (ROLE !== "prime") return;

  pi.registerTool({
    name: "kb_write",
    label: "Write Bundle Knowledge",
    description:
      "Append durable knowledge to the knowledge base shared by every " +
      "session and every user of this bundle. Only store what future " +
      "sessions of this bundle should know: never session-specific notes, " +
      "secrets, or personal data. Target 'long_term' (default) appends to " +
      "MEMORY.md, which every session sees at start; 'daily' appends to " +
      "today's log, which is only found by search. After it succeeds, tell " +
      "the user plainly what you stored.",
    promptSnippet: "Append durable knowledge to the bundle's shared store",
    parameters: Type.Object({
      title: Type.String({
        maxLength: 80,
        description:
          "A short one-line title, shown in the knowledge base's contents list.",
      }),
      content: Type.String({
        description: "The knowledge to store, as concise markdown.",
      }),
      target: Type.Optional(
        Type.Union([Type.Literal("long_term"), Type.Literal("daily")], {
          description: "'long_term' (default) or 'daily'.",
        }),
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: "Tags that improve search, e.g. ['decision', 'api'].",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      return textResult(await callMemory("kb_write", params));
    },
  });

  pi.registerTool({
    name: "kb_forget",
    label: "Forget Bundle Knowledge",
    description:
      "Remove wrong or outdated entries from the bundle knowledge base's " +
      "MEMORY.md: every entry containing `match` (case-insensitive). A match " +
      "hitting too many entries is refused; use a distinctive phrase.",
    promptSnippet: "Remove entries from the bundle's shared knowledge base",
    parameters: Type.Object({
      match: Type.String({
        description: "Distinctive text the entries to remove contain.",
      }),
    }),
    async execute(_toolCallId, params) {
      return textResult(await callMemory("kb_forget", params));
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
      "an existing fact, fetch it with read_memory and pass its exact full " +
      "text (title line included) in `replaces`. After it succeeds, tell the " +
      "user plainly what you stored.",
    promptSnippet:
      "Store a fact in session (or, on explicit request, global) memory",
    parameters: Type.Object({
      title: Type.String({
        maxLength: 80,
        description:
          "A short one-line title, shown in the memory contents list.",
      }),
      text: Type.String({
        description: "The fact to store, as a concise markdown line or block.",
      }),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: "Keywords for the memory index, e.g. ['deploy', 'api'].",
        }),
      ),
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
      title: Type.String({
        maxLength: 80,
        description: "A short one-line title for the proposed fact.",
      }),
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
