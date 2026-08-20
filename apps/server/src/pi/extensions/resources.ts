// @ts-nocheck
/**
 * Resources extension loaded into every session Pi process via `--extension`.
 *
 * Like the other extensions, this is authored against Pi's extension runtime
 * (it imports modules Pi resolves when loading extensions, e.g. `typebox`), not
 * this repo's `node_modules`. It is excluded from our type-check (`@ts-nocheck`)
 * and never imported by the server — only passed as a path to the Pi subprocess.
 *
 * The host resources the shell attaches are baked into the spawn preamble, but
 * the host can add or remove them mid-session. This gives every agent a
 * `read_resources` tool to re-read the current set before relying on it. It is a
 * thin client over this server's internal resources API.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SESSION_ID = process.env.TANGENT_SESSION_ID ?? "";
const INTERNAL_URL = process.env.TANGENT_INTERNAL_URL ?? "";
const INTERNAL_TOKEN = process.env.TANGENT_INTERNAL_TOKEN ?? "";

interface HostResource {
  name: string;
  uri: string;
  meta?: Record<string, unknown>;
}

async function readResources(): Promise<HostResource[]> {
  const url = new URL(`${INTERNAL_URL}/internal/resources/read`);
  url.searchParams.set("sessionId", SESSION_ID);

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${INTERNAL_TOKEN}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `internal API resources/read failed (${response.status}): ${text}`,
    );
  }
  const data = (await response.json()) as { resources: HostResource[] };
  return data.resources ?? [];
}

function render(resources: HostResource[]): string {
  if (resources.length === 0) return "(no host resources)";
  return resources
    .map((resource) => {
      const meta = resource.meta ? `\n  ${JSON.stringify(resource.meta)}` : "";
      return `- ${resource.name} (${resource.uri})${meta}`;
    })
    .join("\n");
}

function textResult(text: string) {
  return { content: [{ type: "text", text }], details: {} };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "read_resources",
    label: "Read Resources",
    description:
      "Read the host resources the embedding app attached to this session " +
      "(e.g. known pipelines). These can change during the session, so re-read " +
      "before relying on or citing them rather than trusting your initial " +
      "context.",
    promptSnippet: "Read the host-attached resources for this session",
    parameters: Type.Object({}),
    async execute() {
      const resources = await readResources();
      return textResult(`## Host resources\n\n${render(resources)}`);
    },
  });
}
