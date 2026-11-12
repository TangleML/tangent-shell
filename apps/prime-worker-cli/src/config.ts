import { parseArgs } from "node:util";

import {
  normalizeShellUrl,
  parseSessionRef,
} from "@tangent/local-agent-host/shellUrl.ts";

/** Exactly one of `projectId` (use it) and `workspace` (create one in it) is set. */
export interface ProjectTarget {
  tangleUrl: string;
  projectId: string | undefined;
  workspace: string | undefined;
}

/**
 * Exactly one of `sessionId` (join) and `title` (create) is set. A new session
 * goes in `project` when it is set; otherwise on `shellUrl`.
 */
export interface WorkerConfig {
  shellUrl: string | undefined;
  project: ProjectTarget | undefined;
  sessionId: string | undefined;
  title: string | undefined;
  bundleId: string | undefined;
}

const clean = (value: string | undefined) => value?.trim() || undefined;

function resolveShellUrl(
  flag: string | undefined,
  session: string | undefined,
  env: NodeJS.ProcessEnv,
): string {
  const pasted = session?.includes("://") ? session : undefined;
  // A pasted session link names its Shell, so it outranks the default.
  const source = clean(flag) ?? pasted ?? clean(env.TANGENT_SHELL_URL);
  if (!source) {
    throw new Error("Set --url or TANGENT_SHELL_URL to the Tangent Shell URL.");
  }
  return normalizeShellUrl(source);
}

const OPTIONS = {
  url: { type: "string" },
  session: { type: "string" },
  new: { type: "string" },
  bundle: { type: "string" },
  project: { type: "string" },
  workspace: { type: "string" },
  tangle: { type: "string" },
} as const;

type Flags = Partial<Record<keyof typeof OPTIONS, string>>;

/** A project id, or a Tangle project link that also gives the Tangle URL. */
function parseProjectRef(ref: string | undefined): {
  projectId?: string;
  tangleUrl?: string;
} {
  if (!ref) return {};
  if (!ref.includes("://")) return { projectId: ref };
  const url = new URL(ref);
  const id = /\/projects\/([^/]+)/.exec(url.pathname)?.[1];
  if (!id) throw new Error(`${ref} is not a Tangle project link.`);
  return { projectId: decodeURIComponent(id), tangleUrl: url.origin };
}

function resolveProject(flags: Flags, env: NodeJS.ProcessEnv): ProjectTarget {
  const ref = parseProjectRef(flags.project);
  const tangleUrl = ref.tangleUrl ?? flags.tangle ?? clean(env.TANGLE_URL);
  if (!tangleUrl) {
    throw new Error("Set --tangle or TANGLE_URL, or pass a project link.");
  }
  return {
    tangleUrl: tangleUrl.replace(/\/+$/, ""),
    projectId: ref.projectId,
    workspace: flags.workspace,
  };
}

/** Rejects flags that would be silently ignored for the chosen target. */
function rejectIgnored(flags: Flags, inProject: boolean): void {
  if (inProject && flags.url) {
    throw new Error(
      "--project and --workspace use the workspace's Shell; drop --url.",
    );
  }
  if (!inProject && flags.tangle) {
    throw new Error("--tangle needs --project or --workspace.");
  }
}

/** Rejects flag mixes that name two targets; true when a project is the target. */
function checkFlags(flags: Flags): boolean {
  if (!flags.session === !flags.new) {
    throw new Error("Pass exactly one of --session <id|url> or --new <title>.");
  }
  const places = [flags.project, flags.workspace].filter(Boolean).length;
  if (places > 1) throw new Error("Pass one of --project or --workspace.");
  if (places === 1 && flags.session) {
    throw new Error("--project and --workspace start a session; use --new.");
  }
  rejectIgnored(flags, places === 1);
  return places === 1;
}

/** Parses the flags; a pasted session URL also supplies the Shell URL. */
export function parseConfig(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  const { values } = parseArgs({ args: argv, options: OPTIONS });
  const flags: Flags = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, clean(value)]),
  );
  const inProject = checkFlags(flags);
  return {
    shellUrl: inProject
      ? undefined
      : resolveShellUrl(flags.url, flags.session, env),
    project: inProject ? resolveProject(flags, env) : undefined,
    sessionId: flags.session && parseSessionRef(flags.session),
    title: flags.new,
    bundleId: flags.bundle,
  };
}
