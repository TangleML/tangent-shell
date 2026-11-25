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
 * The tools are thin clients over this server's internal session API; the
 * server owns the session record and pushes changes to the UI. Every agent can
 * pin and unpin artifacts. Prime alone can rename the session, dismiss finished
 * sub-agents, and ask (or close) structured questions: `ask_question` posts a
 * question card and returns `terminate: true`, so Prime's turn ends there and
 * the answer arrives as its next message.
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
    throw new Error(
      `internal API ${endpoint} failed (${response.status}): ${text}`,
    );
  }
  return response.json();
}

function textResult(text: string) {
  return { content: [{ type: "text", text }], details: {} };
}

export default function (pi: ExtensionAPI) {
  // Pinning artifacts is available to every agent: any agent that produces a
  // user-facing artifact can surface it in the UI's quick-access list.
  pi.registerTool({
    name: "pin_artifact",
    label: "Pin Artifact",
    description:
      "Pin a finished deliverable so it shows in the project's reports and " +
      "the chat's files. Pin only polished work the user asked for and " +
      "could share as is, such as a report, page, deck or summary. Don't pin " +
      "evidence, exports, source dumps, notes, plans or drafts: every file " +
      "in `artifacts/` is already listed for the user without a pin. Pass " +
      "the artifact's path relative to your workspace root (e.g. " +
      "`artifacts/report.html`). Re-pinning the same path just updates its " +
      "title.",
    promptSnippet: "Pin a finished deliverable to the project's reports",
    parameters: Type.Object({
      path: Type.String({
        description:
          "Path to the artifact relative to your workspace root, e.g. " +
          "`artifacts/report.html`.",
      }),
      title: Type.Optional(
        Type.String({
          description:
            "Short, human-readable label shown in the UI. Defaults to the path.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      await callApi("POST", "pin-artifact", {
        sessionId: SESSION_ID,
        path: params.path,
        title: params.title,
      });
      const label = params.title?.trim() || params.path;
      return textResult(`Pinned "${label}" to the UI.`);
    },
  });

  pi.registerTool({
    name: "unpin_artifact",
    label: "Unpin Artifact",
    description:
      "Unpin a file you pinned, taking it out of the project's reports and " +
      "the chat's files, as the unpin button does. Use it when a pinned file " +
      "was replaced by a newer one or turned out not to be ready to share. " +
      "The file itself stays in the workspace and is still listed for the " +
      "user. Pass the same path you pinned, relative to your workspace root.",
    promptSnippet: "Take a pinned file out of the project's reports",
    parameters: Type.Object({
      path: Type.String({
        description:
          "Path of the pinned file relative to your workspace root, e.g. " +
          "`artifacts/report.html`.",
      }),
    }),
    async execute(_toolCallId, params) {
      await callApi("POST", "unpin-artifact", {
        sessionId: SESSION_ID,
        path: params.path,
      });
      return textResult(`Unpinned "${params.path}".`);
    },
  });

  // Renaming the session is a Prime-only concern; sub-agents get nothing.
  if (ROLE !== "prime") return;

  pi.registerTool({
    name: "dismiss_subagent",
    label: "Dismiss Sub-agent",
    description:
      "Dismiss a finished sub-agent from the chat's agents list, as the " +
      "agents pill's remove button does, so finished work stops crowding " +
      "it. It only works on a sub-agent that has completed, failed or been " +
      "stopped; a running one is refused. Its thread is kept; it just leaves " +
      "the list for everyone in the chat.",
    promptSnippet: "Remove a finished sub-agent from the agents list",
    parameters: Type.Object({
      agentId: Type.String({
        description: "Id of the finished sub-agent to dismiss.",
      }),
    }),
    async execute(_toolCallId, params) {
      await callApi("POST", "dismiss-subagent", {
        sessionId: SESSION_ID,
        agentId: params.agentId,
      });
      return textResult(`Dismissed sub-agent ${params.agentId}.`);
    },
  });

  pi.registerTool({
    name: "ask_question",
    label: "Ask Question",
    description:
      "Ask the people in this chat 1 to 4 structured questions when you need " +
      "their decision to continue, instead of asking in prose. Each question " +
      "has a short header (max 12 chars), the question, and 2 to 6 options " +
      "(or none for free text); people can always answer in their own words " +
      "too. Put your recommended option first and end its label with " +
      '" (Recommended)". Your turn ends when you call this: do not call other ' +
      "tools in the same step, and do not repeat the question in prose. The " +
      "answer arrives later as the next message. People may also reply in " +
      "chat instead: the question stays open, and each message you get while " +
      "it is open says so; close it with cancel_question once a reply " +
      "answers it. If nobody answers before it expires (24 h by default) you " +
      "are told and can go ahead. Use a short expiresInSeconds (e.g. 300) to " +
      "ask without waiting long, when your recommended option is a fine " +
      "default.",
    promptSnippet: "Ask people structured questions; ends your turn",
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          id: Type.Optional(
            Type.String({ description: "Stable id, unique in this call." }),
          ),
          header: Type.String({
            maxLength: 12,
            description: "Short chip label, e.g. 'Scope'.",
          }),
          question: Type.String({ description: "The full question." }),
          options: Type.Optional(
            Type.Array(
              Type.Object({
                label: Type.String(),
                description: Type.Optional(Type.String()),
              }),
              { maxItems: 6, description: "0 (free text) or 2 to 6 choices." },
            ),
          ),
          multiSelect: Type.Optional(
            Type.Boolean({ description: "Allow picking several options." }),
          ),
        }),
        { minItems: 1, maxItems: 4 },
      ),
      peopleOnly: Type.Optional(
        Type.Boolean({
          description:
            "Only a person should answer, not an orchestrator acting for one.",
        }),
      ),
      expiresInSeconds: Type.Optional(
        Type.Integer({
          minimum: 60,
          maximum: 604800,
          description:
            "Close unanswered after this long (default 24 h). Short means " +
            "'ask, but don't wait long'.",
        }),
      ),
      idempotencyKey: Type.Optional(
        Type.String({
          description: "Retry key; the same key reuses the question.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const data = (await callApi("POST", "ask-question", {
        sessionId: SESSION_ID,
        ...params,
      })) as { question: { id: string; expiresAt: string } };
      return {
        ...textResult(
          `Asked question ${data.question.id}. Your turn ends now; the answer ` +
            "arrives as the next message.",
        ),
        terminate: true,
      };
    },
  });

  pi.registerTool({
    name: "cancel_question",
    label: "Cancel Question",
    description:
      "Close a question you asked with ask_question that no longer needs a " +
      "structured answer: a person answered it in chat, or it stopped " +
      "mattering. Give a short reason; people see it on the question.",
    promptSnippet: "Close a pending question",
    parameters: Type.Object({
      questionId: Type.String({ description: "The id ask_question returned." }),
      reason: Type.Optional(
        Type.String({
          maxLength: 500,
          description: "Why, e.g. 'Answered in chat: all time'.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const data = (await callApi("POST", "cancel-question", {
        sessionId: SESSION_ID,
        questionId: params.questionId,
        reason: params.reason,
      })) as { outcome: "cancelled" | "closed" };
      return textResult(
        data.outcome === "closed"
          ? `Question ${params.questionId} was already closed.`
          : `Closed question ${params.questionId}.`,
      );
    },
  });

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
