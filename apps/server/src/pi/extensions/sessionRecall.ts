// @ts-nocheck
/**
 * Session-recall extension: Prime's cross-session recall tools. Unlike the
 * always-on extensions it is passed via `--extension` only when the spawn
 * grants recall (Prime in a session with at least one selector tag), and it
 * registers nothing unless `TANGENT_SESSION_RECALL=1` confirms that grant.
 *
 * Like the other extensions it is authored against Pi's extension runtime,
 * excluded from type-check (`@ts-nocheck`), and never imported by the server.
 * It is a thin client over `/internal/session/{related,search,transcript}`,
 * which scope every read to sessions carrying every selector of this one.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SESSION_ID = process.env.TANGENT_SESSION_ID ?? "";
const ROLE = process.env.TANGENT_AGENT_ROLE ?? "subagent";
const RECALL = process.env.TANGENT_SESSION_RECALL === "1";
const INTERNAL_URL = process.env.TANGENT_INTERNAL_URL ?? "";
const INTERNAL_TOKEN = process.env.TANGENT_INTERNAL_TOKEN ?? "";

function textResult(text: string) {
  return { content: [{ type: "text", text }], details: {} };
}

/**
 * GETs a recall read. A `400`/`403` carries the server's refusal text, which
 * is handed to the agent as-is rather than thrown, so a refusal reads the
 * same every time.
 */
async function callRecall(
  endpoint: string,
  query: Record<string, string | number | undefined>,
): Promise<{ data?: unknown; refusal?: string }> {
  const url = new URL(`${INTERNAL_URL}/internal/session/${endpoint}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${INTERNAL_TOKEN}` },
  });
  if (response.status === 400 || response.status === 403) {
    const body = await response.json().catch(() => ({}));
    return { refusal: body.error ?? `Refused (${response.status}).` };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `internal API ${endpoint} failed (${response.status}): ${text}`,
    );
  }
  return { data: await response.json() };
}

/** The 8-character id prefix shown to the agent (what memory stamps use). */
function shortId(id: string): string {
  return id.slice(0, 8);
}

function renderSessions(sessions): string {
  if (!sessions.length) return "(no related sessions)";
  return sessions
    .map(
      (s) =>
        `### ${s.name} [${shortId(s.id)}] (last active ${s.lastActivityAt})\n` +
        (s.summary || "(no summary)"),
    )
    .join("\n\n");
}

function renderHits(hits): string {
  if (!hits.length) return "(no matches in related sessions)";
  return hits
    .map(
      (h) =>
        `- ${h.sessionName} [${shortId(h.sessionId)}] #${h.seq} ` +
        `${h.author}: ${h.snippet}`,
    )
    .join("\n");
}

function renderPage(page): string {
  const header =
    `## ${page.session.name} [${shortId(page.session.id)}] ` +
    `(created ${page.session.createdAt}) — ${page.shown} of ${page.total} messages`;
  const more =
    page.nextFromSeq === undefined
      ? ""
      : `\n\n(more: call again with fromSeq=${page.nextFromSeq})`;
  return `${header}\n\n${page.text || "(no messages)"}${more}`;
}

export default function (pi: ExtensionAPI) {
  if (ROLE !== "prime" || !RECALL) return;

  pi.registerTool({
    name: "list_related_sessions",
    label: "List Related Sessions",
    description:
      "List sessions related to this one (they carry every selector of this " +
      "session, e.g. the same project), newest first, each with its id and " +
      "the running summary its Prime kept. Use it to find which earlier " +
      "session holds something the human refers to.",
    promptSnippet: "List related sessions with their summaries",
    parameters: Type.Object({}),
    async execute() {
      const { data, refusal } = await callRecall("related", {
        sessionId: SESSION_ID,
      });
      return textResult(refusal ?? renderSessions(data.sessions));
    },
  });

  pi.registerTool({
    name: "search_session_transcripts",
    label: "Search Session Transcripts",
    description:
      "Keyword search across the Prime conversations of related sessions " +
      "(those carrying every selector of this session). A message matches " +
      "when it contains every word of the query, case-insensitively. Each hit " +
      "gives the session id, the message's `seq`, and a snippet; pass both to " +
      "`read_session_transcript` to read the exact conversation.",
    promptSnippet: "Search related sessions' conversations by keyword",
    parameters: Type.Object({
      query: Type.String({
        description: "Distinctive words to find, e.g. `bedtime story dragon`.",
      }),
      limit: Type.Optional(
        Type.Number({
          description: "Max hits to return (default 10, max 50).",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const { data, refusal } = await callRecall("search", {
        sessionId: SESSION_ID,
        query: params.query,
        limit: params.limit,
      });
      return textResult(refusal ?? renderHits(data.hits));
    },
  });

  pi.registerTool({
    name: "read_session_transcript",
    label: "Read Session Transcript",
    description:
      "Read the exact Prime conversation (human and Prime messages, in " +
      "order) of a related session. `sessionId` is a full id, the 8-character " +
      "id from a search hit or session list, or a `[xxxxxxxx]` memory stamp. " +
      "Only sessions carrying every selector of this session can be read; any " +
      "other id is refused. Long conversations are paged: pass the returned " +
      "`fromSeq` to continue.",
    promptSnippet: "Read a related session's exact conversation",
    parameters: Type.Object({
      sessionId: Type.String({
        description: "The session's full id, 8-character id, or memory stamp.",
      }),
      fromSeq: Type.Optional(
        Type.Number({
          description: "Start at this message `seq` (default: the first).",
        }),
      ),
      limit: Type.Optional(
        Type.Number({ description: "Max messages (default 50, max 200)." }),
      ),
    }),
    async execute(_toolCallId, params) {
      const { data, refusal } = await callRecall("transcript", {
        sessionId: SESSION_ID,
        target: params.sessionId,
        fromSeq: params.fromSeq,
        limit: params.limit,
      });
      return textResult(refusal ?? renderPage(data));
    },
  });
}
