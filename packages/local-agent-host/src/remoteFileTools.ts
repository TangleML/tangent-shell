import type { RemoteTool, RemoteToolMap } from "@tangent/remote-subagent";

import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_READ_BYTES,
  findFiles,
  listDirectory,
  MAX_READ_BYTES,
  MAX_RESULTS,
  readTextFile,
  searchText,
} from "./fileToolOps.ts";
import { toArgs, type ToolArgs } from "./toolArgs.ts";

interface FileToolSpec extends Omit<RemoteTool, "execute"> {
  run(root: string, args: ToolArgs): Promise<string>;
}

const MAX_RESULTS_SCHEMA = {
  type: "number",
  description: `Default ${DEFAULT_MAX_RESULTS}, max ${MAX_RESULTS}.`,
};

const FILE_TOOLS: Record<string, FileToolSpec> = {
  read_file: {
    description:
      "Read a text file from the user's local workspace (read-only). " +
      "Paths are relative to the workspace root. Large files are truncated.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        maxBytes: {
          type: "number",
          description: `Bytes to read (default ${DEFAULT_READ_BYTES}, max ${MAX_READ_BYTES}).`,
        },
      },
      required: ["path"],
    },
    run: readTextFile,
  },
  list_dir: {
    description:
      "List a directory in the user's local workspace (read-only). " +
      "Directories end with '/'. Build and dependency folders are hidden.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative directory; defaults to the root.",
        },
      },
    },
    run: listDirectory,
  },
  find_files: {
    description:
      "Find files in the user's local workspace by glob (read-only), " +
      "e.g. '*.ts' or 'src/**/*.test.ts'. A glob without '/' matches file names anywhere.",
    inputSchema: {
      type: "object",
      properties: {
        glob: {
          type: "string",
          description: "Glob supporting *, **, ?, {a,b}.",
        },
        maxResults: MAX_RESULTS_SCHEMA,
      },
      required: ["glob"],
    },
    run: findFiles,
  },
  search_text: {
    description:
      "Search file contents in the user's local workspace (read-only). " +
      "Returns 'path:line: text' for each matching line.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text to find, or a regex with regex: true.",
        },
        regex: {
          type: "boolean",
          description: "Treat query as a JavaScript regex.",
        },
        ignoreCase: {
          type: "boolean",
          description: "Match case-insensitively.",
        },
        glob: {
          type: "string",
          description: "Only search files matching this glob.",
        },
        maxResults: MAX_RESULTS_SCHEMA,
      },
      required: ["query"],
    },
    run: searchText,
  },
};

/**
 * Read-only workspace tools Prime calls over `/remote-env` without spawning a
 * local sub-agent. Every path is resolved against `getRoot()` at call time.
 */
export function createFileTools(
  getRoot: () => string | undefined,
): RemoteToolMap {
  const entries = Object.entries(FILE_TOOLS).map(
    ([name, { run, ...spec }]): [string, RemoteTool] => [
      name,
      {
        ...spec,
        async execute(args) {
          const root = getRoot();
          if (!root)
            throw new Error("No folder is open in the user's local workspace.");
          return run(root, toArgs(args));
        },
      },
    ],
  );
  return Object.fromEntries(entries);
}
