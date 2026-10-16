import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type { PiLaunchOptions } from "@tangent/local-agent-host/piAdapter.ts";
import {
  normalizeShellUrl,
  parseSessionRef,
  sessionIdFromUrl,
} from "@tangent/local-agent-host/shellUrl.ts";

const OPTIONS = {
  url: { type: "string" },
  session: { type: "string" },
  cwd: { type: "string" },
  "host-id": { type: "string" },
  "pi-bin": { type: "string" },
  model: { type: "string" },
  "pi-proxy-url": { type: "string" },
  description: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

/** pi loads this from disk, so the build copies it next to the bundle. */
const PROXY_PROVIDER_PATH = fileURLToPath(
  new URL("proxyProvider.ts", import.meta.url),
);

/** Session-resources extension; copied next to the bundle like the proxy one. */
const SESSION_RESOURCES_PATH = fileURLToPath(
  new URL("sessionResources.ts", import.meta.url),
);

type Env = Record<string, string | undefined>;
type CliValues = ReturnType<typeof parseFlags>["values"];

export interface CliConfig {
  url: string;
  token: string;
  sessionId?: string;
  /** Routes this host to matching sessions, e.g. `sessionId:<id>`. */
  selector: string;
  environmentId: string;
  /** Self-description Prime reads to tell this host apart and match work to it. */
  metadata: Record<string, string>;
  launch: PiLaunchOptions & { cwd: string };
}

function parseFlags(argv: string[]) {
  return parseArgs({ args: argv, options: OPTIONS });
}

/** A flag, else its environment variable, trimmed; `undefined` when empty. */
function setting(
  flag: string | undefined,
  env: Env,
  envName: string,
): string | undefined {
  return (flag ?? env[envName])?.trim() || undefined;
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function defaultHostId(): string {
  const host = hostname()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");
  return `cli-${host}-${randomUUID().slice(0, 8)}`;
}

function launchOptions(values: CliValues, env: Env): CliConfig["launch"] {
  const proxyUrl = setting(values["pi-proxy-url"], env, "TANGENT_PI_PROXY_URL");
  return {
    bin: setting(values["pi-bin"], env, "TANGENT_PI_BIN") ?? "pi",
    cwd: path.resolve(values.cwd ?? "."),
    model: setting(values.model, env, "TANGENT_PI_MODEL"),
    proxyUrl,
    proxyApiKey: proxyUrl ? env.PI_PROXY_API_KEY : undefined,
    proxyExtensionPath: PROXY_PROVIDER_PATH,
    sessionResourceExtensionPath: SESSION_RESOURCES_PATH,
  };
}

/**
 * The self-description this host advertises: what it is and what it can build,
 * so Prime can tell it apart from other connected hosts and match work to it.
 * `description` is overridable; the rest is derived from the host's environment.
 */
function buildMetadata(
  cwd: string,
  description: string | undefined,
): Record<string, string> {
  return {
    editor: "tangent-local-agent",
    workspacePath: cwd,
    description:
      description ?? `Tangent Local Agent on ${hostname()}, working in ${cwd}.`,
    capabilities:
      "Runs local pi sub-agents that read, edit, and run commands in this workspace.",
  };
}

/** Parses argv and the environment; `"help"` when usage was requested. */
export function parseCli(argv: string[], env: Env): CliConfig | "help" {
  const { values } = parseFlags(argv);
  if (values.help) return "help";
  const rawUrl = required(
    setting(values.url, env, "TANGENT_SHELL_URL"),
    "Pass --url <shell url> or set TANGENT_SHELL_URL.",
  );
  const token = required(
    setting(undefined, env, "REMOTE_ENV_TOKEN"),
    "Set REMOTE_ENV_TOKEN to the Shell's remote environment token.",
  );
  const session = setting(values.session, env, "TANGENT_SESSION_ID");
  const sessionId = session
    ? parseSessionRef(session)
    : sessionIdFromUrl(rawUrl);
  const hostId =
    setting(values["host-id"], env, "TANGENT_HOST_ID") ?? defaultHostId();
  const launch = launchOptions(values, env);
  const description = setting(
    values.description,
    env,
    "TANGENT_HOST_DESCRIPTION",
  );
  return {
    url: normalizeShellUrl(rawUrl),
    token,
    sessionId,
    selector: sessionId ? `sessionId:${sessionId}` : hostId,
    environmentId: sessionId ? `${sessionId}:${hostId}` : hostId,
    metadata: buildMetadata(launch.cwd, description),
    launch,
  };
}
