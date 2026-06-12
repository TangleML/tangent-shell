// @ts-nocheck
/**
 * Session extension loaded into every session Pi process via `--extension`.
 *
 * Like the orchestrator/memory/triggers extensions, this is authored against
 * Pi's extension runtime (it imports modules Pi resolves when loading
 * extensions, e.g. `typebox`), not this repo's `node_modules`. It is excluded
 * from type-check (`@ts-nocheck`) and never imported by the server — only passed
 * as a path to the Pi subprocess.
 *
 * The tool is Prime-only and is a thin client over this server's internal
 * session API; the server owns the session record, applies the rename, and
 * pushes the change to the UI over the generic `ui:command` socket channel. It
 * lets Prime give the session a concise, conversation-derived name (replacing
 * the default "Session N") and refine it as the topic evolves.
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
  const url = new URL(`${INTERNAL_URL}/internal/session/${endpoint}`);
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
  // Renaming the session is a Prime-only concern; sub-agents get nothing.
  if (ROLE !== "prime") return;

  pi.registerTool({
    name: "rename_session",
    label: "Rename Session",
    description:
      "Rename this chat session. Sessions start with a generic name like " +
      '"Session 3"; once you understand what the user wants, call this to set ' +
      "a short, descriptive title (about 3-6 words) derived from the " +
      "conversation topic. Call it again to refine the name if the topic " +
      "shifts substantially. The new name is shown in the UI immediately. When " +
      "the user asks you to rename the session but doesn't specify a name, " +
      "infer a fitting title from the conversation and call this directly — do " +
      "not ask them what name to use.",
    promptSnippet: "Rename this session to a concise, topic-based title",
    parameters: Type.Object({
      name: Type.String({
        description:
          "The new session name: a concise, human-readable title (about 3-6 " +
          "words). Infer it from the conversation when the user didn't give one.",
      }),
    }),
    async execute(_toolCallId, params) {
      const data = (await callApi("POST", "rename", {
        sessionId: SESSION_ID,
        name: params.name,
      })) as { session: { name: string } };

      return textResult(`Renamed this session to "${data.session.name}".`);
    },
  });
}
