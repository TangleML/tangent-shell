// @ts-nocheck
/**
 * Orchestrator extension loaded into every session Pi process via `--extension`.
 *
 * This file is authored against Pi's extension runtime (it imports modules that
 * Pi resolves when loading extensions, e.g. `typebox`), not against this repo's
 * `node_modules`. It is therefore excluded from our type-check (`@ts-nocheck`)
 * and is never imported by the server itself — only passed as a path to the Pi
 * subprocess, which loads it with jiti.
 *
 * Role is taken from `TANGENT_AGENT_ROLE`:
 * - `prime`: gets tools to spawn / message / kill / list sub-agents, plus
 *   `read_room`. Prime is the only agent allowed to direct sub-agents.
 * - `subagent`: gets only `read_room` so it can read the shared transcript.
 *
 * All tools are thin clients over this server's internal agent API; the server
 * owns process lifecycle and message routing.
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
  const url = new URL(`${INTERNAL_URL}/internal/agents/${endpoint}`);
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
  // Every agent can read the shared room transcript.
  pi.registerTool({
    name: "read_room",
    label: "Read Room",
    description:
      "Read the recent shared chat transcript for this session, including " +
      "messages from the human, Prime, and all sub-agents. Use this to see " +
      "what other agents have said before acting.",
    promptSnippet: "Read the shared session transcript (human + all agents)",
    parameters: Type.Object({
      limit: Type.Optional(
        Type.Number({
          description: "Max number of most recent messages to return (default 30).",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const data = (await callApi("GET", "room", undefined, {
        sessionId: SESSION_ID,
        ...(params.limit ? { limit: String(params.limit) } : {}),
      })) as { messages: Array<{ author: { name: string }; content: string }> };

      if (!data.messages.length) {
        return textResult("(the room is empty so far)");
      }
      const transcript = data.messages
        .map((m) => `${m.author.name}: ${m.content}`)
        .join("\n\n");
      return textResult(transcript);
    },
  });

  if (ROLE !== "prime") return;

  // Prime-only orchestration tools below.
  pi.registerTool({
    name: "spawn_subagent",
    label: "Spawn Sub-agent",
    description:
      "Create a new sub-agent in this session. Provide a short name. Either " +
      "pick a `template` (see list) and/or override `system_prompt` and " +
      "`tools` inline. Optionally include a `task` to start the sub-agent " +
      "working immediately. Returns the sub-agent's id for later messaging. " +
      "Sub-agents share this session's workspace and can read the room.",
    promptSnippet: "Spawn a specialized sub-agent (by template or inline config)",
    parameters: Type.Object({
      name: Type.String({ description: "Short display name for the sub-agent." }),
      template: Type.Optional(
        Type.String({ description: "Name of a predefined agent template." }),
      ),
      system_prompt: Type.Optional(
        Type.String({ description: "Inline system prompt; overrides template." }),
      ),
      tools: Type.Optional(
        Type.Array(Type.String(), {
          description: "Inline tool allowlist; overrides template tools.",
        }),
      ),
      task: Type.Optional(
        Type.String({ description: "Initial task to send the sub-agent now." }),
      ),
    }),
    async execute(_toolCallId, params) {
      const data = (await callApi("POST", "spawn", {
        sessionId: SESSION_ID,
        name: params.name,
        template: params.template,
        systemPrompt: params.system_prompt,
        tools: params.tools,
        task: params.task,
      })) as { subagent: { id: string; name: string } };

      return textResult(
        `Spawned sub-agent "${data.subagent.name}" (id: ${data.subagent.id}). ` +
          `Its replies will appear in the room; use message_subagent to direct it.`,
      );
    },
  });

  pi.registerTool({
    name: "message_subagent",
    label: "Message Sub-agent",
    description:
      "Send a directed message/task to one of your sub-agents by id. This is " +
      "non-blocking: the sub-agent works asynchronously and its reply streams " +
      "into the room, then is summarized back to you.",
    promptSnippet: "Send a directed task to a sub-agent (non-blocking)",
    parameters: Type.Object({
      id: Type.String({ description: "The sub-agent id from spawn_subagent." }),
      message: Type.String({ description: "Instruction or task for the sub-agent." }),
    }),
    async execute(_toolCallId, params) {
      await callApi("POST", "message", {
        sessionId: SESSION_ID,
        agentId: params.id,
        text: params.message,
      });
      return textResult(`Delivered message to sub-agent ${params.id}.`);
    },
  });

  pi.registerTool({
    name: "kill_subagent",
    label: "Kill Sub-agent",
    description:
      "Terminate a sub-agent by id. Set `completed` to true when it has " +
      "finished its work successfully (vs. aborting it).",
    promptSnippet: "Terminate a sub-agent you no longer need",
    parameters: Type.Object({
      id: Type.String({ description: "The sub-agent id to terminate." }),
      completed: Type.Optional(
        Type.Boolean({ description: "True if the sub-agent finished its work." }),
      ),
    }),
    async execute(_toolCallId, params) {
      await callApi("POST", "kill", {
        sessionId: SESSION_ID,
        agentId: params.id,
        completed: params.completed ?? false,
      });
      return textResult(`Terminated sub-agent ${params.id}.`);
    },
  });

  pi.registerTool({
    name: "list_subagents",
    label: "List Sub-agents",
    description:
      "List this session's sub-agents with their ids and current status " +
      "(active / completed / killed / error).",
    promptSnippet: "List your sub-agents and their statuses",
    parameters: Type.Object({}),
    async execute() {
      const data = (await callApi("GET", "list", undefined, {
        sessionId: SESSION_ID,
      })) as {
        subagents: Array<{ id: string; name: string; status: string }>;
      };

      if (!data.subagents.length) {
        return textResult("No sub-agents have been spawned yet.");
      }
      const lines = data.subagents
        .map((s) => `- ${s.name} (id: ${s.id}) — ${s.status}`)
        .join("\n");
      return textResult(lines);
    },
  });
}
