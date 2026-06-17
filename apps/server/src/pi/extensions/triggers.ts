// @ts-nocheck
/**
 * Triggers extension loaded into every session Pi process via `--extension`.
 *
 * Like the orchestrator extension, this is authored against Pi's extension
 * runtime (it imports modules Pi resolves when loading extensions, e.g.
 * `typebox`), not this repo's `node_modules`. It is excluded from type-check
 * (`@ts-nocheck`) and never imported by the server — only passed as a path to
 * the Pi subprocess.
 *
 * The tools are Prime-only and are thin clients over this server's internal
 * triggers API; the server owns persistence, scheduling, and delivery. They let
 * Prime create/list/enable/disable/delete the session's triggers when the user
 * asks (e.g. "set up an hourly check" or "give me a webhook I can call").
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
  const url = new URL(`${INTERNAL_URL}/internal/triggers/${endpoint}`);
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
  // Triggers are a Prime-only orchestration concern; sub-agents get nothing.
  if (ROLE !== "prime") return;

  pi.registerTool({
    name: "create_trigger",
    label: "Create Trigger",
    description:
      "Create a trigger for this session. A trigger turns an external signal " +
      "into a prompt delivered to its target. Two kinds: `schedule` fires on a " +
      'timer (provide `schedule.every` like "1h"/"30m"/"45s", or a ' +
      "`schedule.cron` expression); `callback` returns a secret URL an " +
      "external system can POST to. Provide a `prompt` — the message the target " +
      "receives when it fires (callback payload fields can be interpolated with " +
      "{{body.field}}). By DEFAULT the trigger spins up a dedicated sub-agent " +
      "that reacts to each firing in isolation; describe it via `subagent` " +
      "(its name/template/system_prompt/tools). Set `target` to `prime` to " +
      "route firings to yourself instead — this is DISCOURAGED; prefer a " +
      "dedicated sub-agent so trigger work doesn't interrupt the human " +
      "conversation. Returns the trigger, including the callback URL for " +
      "callback triggers.",
    promptSnippet: "Create a schedule or callback trigger for this session",
    parameters: Type.Object({
      name: Type.String({
        description: "Short slug id for the trigger (lowercase, dashes).",
      }),
      kind: Type.Union([Type.Literal("schedule"), Type.Literal("callback")], {
        description: "`schedule` (timer) or `callback` (inbound URL).",
      }),
      prompt: Type.String({
        description:
          "The prompt delivered to the target when the trigger fires.",
      }),
      title: Type.Optional(
        Type.String({ description: "Human-readable label for the trigger." }),
      ),
      target: Type.Optional(
        Type.Union([Type.Literal("subagent"), Type.Literal("prime")], {
          description:
            "Where firings go: `subagent` (default; a dedicated sub-agent " +
            "reacts in isolation) or `prime` (you receive it — discouraged).",
        }),
      ),
      subagent: Type.Optional(
        Type.Object(
          {
            name: Type.Optional(
              Type.String({
                description: "Display name (defaults to the trigger's title).",
              }),
            ),
            template: Type.Optional(
              Type.String({ description: "Predefined agent template name." }),
            ),
            system_prompt: Type.Optional(
              Type.String({ description: "Inline system prompt." }),
            ),
            tools: Type.Optional(
              Type.Array(Type.String(), {
                description: "Inline tool allowlist.",
              }),
            ),
            model: Type.Optional(
              Type.String({ description: "Model id (`provider/model`)." }),
            ),
            thinking: Type.Optional(
              Type.String({
                description:
                  "Thinking depth: off, minimal, low, medium, high, or xhigh.",
              }),
            ),
          },
          {
            description:
              "Spec for the dedicated sub-agent (used when target is subagent).",
          },
        ),
      ),
      schedule: Type.Optional(
        Type.Object(
          {
            every: Type.Optional(
              Type.String({
                description: 'Interval, e.g. "1h", "30m", "45s".',
              }),
            ),
            cron: Type.Optional(
              Type.String({ description: "Cron expression (5- or 6-field)." }),
            ),
          },
          { description: "Required for `schedule` triggers." },
        ),
      ),
      enabled: Type.Optional(
        Type.Boolean({ description: "Arm the trigger now (default true)." }),
      ),
    }),
    async execute(_toolCallId, params) {
      const subagent = params.subagent
        ? {
            name: params.subagent.name,
            template: params.subagent.template,
            systemPrompt: params.subagent.system_prompt,
            tools: params.subagent.tools,
            model: params.subagent.model,
            thinkingDepth: params.subagent.thinking,
          }
        : undefined;

      const data = (await callApi("POST", "create", {
        sessionId: SESSION_ID,
        name: params.name,
        kind: params.kind,
        prompt: params.prompt,
        title: params.title,
        target: params.target,
        subagent,
        schedule: params.schedule,
        enabled: params.enabled,
      })) as {
        trigger: {
          name: string;
          kind: string;
          callbackPath?: string;
          target?: { type: string; agentName?: string };
        };
      };

      const trigger = data.trigger;
      const handledBy =
        trigger.target?.type === "subagent"
          ? `Sub-agent "${trigger.target.agentName ?? trigger.name}" will react to it`
          : "It will be delivered to you (Prime)";

      if (trigger.kind === "callback" && trigger.callbackPath) {
        return textResult(
          `Created callback trigger "${trigger.name}". External systems can ` +
            `POST to ${trigger.callbackPath} to fire it (the JSON body is ` +
            `available to the prompt as {{body.*}}). ${handledBy}.`,
        );
      }
      return textResult(
        `Created schedule trigger "${trigger.name}". ${handledBy} on its ` +
          `schedule until disabled.`,
      );
    },
  });

  pi.registerTool({
    name: "list_triggers",
    label: "List Triggers",
    description:
      "List this session's triggers with their kind, schedule/callback, and " +
      "whether they are enabled.",
    promptSnippet: "List this session's triggers",
    parameters: Type.Object({}),
    async execute() {
      const data = (await callApi("GET", "list", undefined, {
        sessionId: SESSION_ID,
      })) as {
        triggers: Array<{
          name: string;
          kind: string;
          enabled: boolean;
          schedule?: { every?: string; cron?: string };
          callbackPath?: string;
          target?: { type: string; agentName?: string };
        }>;
      };

      if (!data.triggers.length) {
        return textResult("No triggers have been created yet.");
      }
      const lines = data.triggers.map((t) => {
        const state = t.enabled ? "enabled" : "disabled";
        const detail =
          t.kind === "schedule"
            ? `every ${t.schedule?.every ?? t.schedule?.cron ?? "?"}`
            : (t.callbackPath ?? "callback");
        const target =
          t.target?.type === "subagent"
            ? `→ sub-agent "${t.target.agentName ?? t.name}"`
            : "→ Prime";
        return `- ${t.name} (${t.kind}, ${state}) — ${detail} ${target}`;
      });
      return textResult(lines.join("\n"));
    },
  });

  pi.registerTool({
    name: "enable_trigger",
    label: "Enable Trigger",
    description: "Enable (arm) a trigger by name.",
    promptSnippet: "Enable a trigger by name",
    parameters: Type.Object({
      name: Type.String({ description: "The trigger's name." }),
    }),
    async execute(_toolCallId, params) {
      await callApi("POST", "update", {
        sessionId: SESSION_ID,
        name: params.name,
        enabled: true,
      });
      return textResult(`Enabled trigger "${params.name}".`);
    },
  });

  pi.registerTool({
    name: "disable_trigger",
    label: "Disable Trigger",
    description: "Disable (disarm) a trigger by name without deleting it.",
    promptSnippet: "Disable a trigger by name",
    parameters: Type.Object({
      name: Type.String({ description: "The trigger's name." }),
    }),
    async execute(_toolCallId, params) {
      await callApi("POST", "update", {
        sessionId: SESSION_ID,
        name: params.name,
        enabled: false,
      });
      return textResult(`Disabled trigger "${params.name}".`);
    },
  });

  pi.registerTool({
    name: "delete_trigger",
    label: "Delete Trigger",
    description: "Permanently delete a trigger by name.",
    promptSnippet: "Delete a trigger by name",
    parameters: Type.Object({
      name: Type.String({ description: "The trigger's name." }),
    }),
    async execute(_toolCallId, params) {
      await callApi("POST", "delete", {
        sessionId: SESSION_ID,
        name: params.name,
      });
      return textResult(`Deleted trigger "${params.name}".`);
    },
  });
}
