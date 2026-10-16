// @ts-nocheck
/**
 * Loaded into local pi sub-agents via `--extension` so an agent working in the
 * user's local workspace can contribute files/blobs to the Tangent *session* —
 * where Prime and other agents (including those on other environments) can see
 * and fetch them. Hosts copy it next to their bundle. Authored against pi's
 * extension runtime (loaded with jiti), so it is excluded from this package's
 * type-check and lint. Mirrors the server's host-resource extension, but calls
 * the host's loopback API instead of the server's internal API.
 */

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const API_URL = (process.env.TANGENT_HOST_API_URL ?? "").replace(/\/+$/, "");
const API_TOKEN = process.env.TANGENT_HOST_API_TOKEN ?? "";
const SESSION_ID = process.env.TANGENT_SESSION_ID ?? "";
const AGENT_ID = process.env.TANGENT_AGENT_ID ?? "";

/** Matches the server's per-file resource cap (MAX_FILE_RESOURCE_BYTES). */
const MAX_FILE_BYTES = 1024 * 1024;

async function callHostApi(route: string, payload: unknown): Promise<unknown> {
  if (!API_URL) throw new Error("Session resources are unavailable here.");
  const response = await fetch(`${API_URL}/${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: unknown;
    error?: string;
  };
  if (!response.ok || !data.ok) {
    throw new Error(
      data.error ?? `host API ${route} failed (${response.status})`,
    );
  }
  return data.result;
}

function textResult(text: string) {
  return { content: [{ type: "text", text }], details: {} };
}

function renderList(resources: Array<{ name: string; uri: string }>): string {
  if (!resources || resources.length === 0) return "(no session resources)";
  return resources.map((r) => `- ${r.name} (${r.uri})`).join("\n");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "put_session_resource",
    label: "Put Session Resource",
    description:
      "Write a file/blob into the Tangent session so Prime and other agents " +
      "(including those on other environments) can fetch it. Pass 'content' " +
      "inline for small pieces (binary must be base64 with encoding: 'base64'), " +
      "or pass 'sourcePath' to upload a local file the tool reads itself without " +
      "inlining its bytes. Provide exactly one of content/sourcePath. The decoded " +
      "size limit is 1 MiB.",
    promptSnippet: "Contribute a file to the Tangent session",
    parameters: Type.Object({
      path: Type.String({
        description: "Destination path inside the session's uploads/ folder.",
      }),
      content: Type.Optional(
        Type.String({
          description:
            "Inline file contents (text, or base64). Use for small pieces.",
        }),
      ),
      sourcePath: Type.Optional(
        Type.String({
          description:
            "Local file path the tool reads itself (preferred for large files). " +
            "Resolved against the sub-agent's working folder.",
        }),
      ),
      encoding: Type.Optional(
        Type.Union([Type.Literal("utf8"), Type.Literal("base64")], {
          description:
            "How inline content is decoded. Defaults to utf8. Ignored for sourcePath.",
        }),
      ),
      name: Type.Optional(
        Type.String({ description: "Catalog display name; defaults to path." }),
      ),
      contentType: Type.Optional(
        Type.String({ description: "MIME type recorded in the catalog meta." }),
      ),
    }),
    async execute(
      _toolCallId: string,
      args: {
        path: string;
        content?: string;
        sourcePath?: string;
        encoding?: "utf8" | "base64";
        name?: string;
        contentType?: string;
      },
    ) {
      const hasContent = args.content !== undefined;
      const hasSource = args.sourcePath !== undefined && args.sourcePath !== "";
      if (hasContent === hasSource) {
        throw new Error("Provide exactly one of 'content' or 'sourcePath'.");
      }

      let content = args.content ?? "";
      let encoding: "utf8" | "base64" = args.encoding ?? "utf8";
      let defaultName = args.path;
      if (hasSource) {
        const absolute = resolve(process.cwd(), args.sourcePath as string);
        const bytes = await readFile(absolute);
        if (bytes.byteLength > MAX_FILE_BYTES) {
          throw new Error(
            `File is ${bytes.byteLength} bytes; the session resource limit is 1 MiB.`,
          );
        }
        content = bytes.toString("base64");
        encoding = "base64";
        defaultName = basename(absolute);
      }

      const input = {
        kind: "file",
        path: args.path,
        content,
        encoding,
        name: args.name ?? defaultName,
        ...(args.contentType
          ? { meta: { contentType: args.contentType } }
          : {}),
      };
      const resource = (await callHostApi("put", {
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        input,
      })) as { uri: string };
      return textResult(`Added session resource ${resource.uri}`);
    },
  });

  pi.registerTool({
    name: "list_session_resources",
    label: "List Session Resources",
    description:
      "List the files and resources catalogued in the Tangent session, " +
      "including those contributed by Prime and agents on other environments.",
    promptSnippet: "List the Tangent session's resources",
    parameters: Type.Object({}),
    async execute() {
      const resources = (await callHostApi("list", {
        sessionId: SESSION_ID,
      })) as Array<{ name: string; uri: string }>;
      return textResult(`## Session resources\n\n${renderList(resources)}`);
    },
  });

  pi.registerTool({
    name: "read_session_resource",
    label: "Read Session Resource",
    description:
      "Read a Tangent session resource's contents by its uri (e.g. " +
      "'uploads/report.csv'), including content another environment contributed.",
    promptSnippet: "Read a Tangent session resource",
    parameters: Type.Object({
      uri: Type.String({ description: "Session-root-relative resource uri." }),
    }),
    async execute(_toolCallId: string, args: { uri: string }) {
      const result = (await callHostApi("read", {
        sessionId: SESSION_ID,
        uri: args.uri,
      })) as { content: string; contentType: string };
      const text = Buffer.from(result.content, "base64").toString("utf8");
      return textResult(text);
    },
  });
}
