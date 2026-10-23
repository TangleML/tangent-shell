import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  type AcpAgentCommand,
  acpAgentNames,
  resolveAcpAgent,
} from "@tangent/acp-attach-host/acpAgents.ts";
import {
  normalizeShellUrl,
  parseSessionRef,
} from "@tangent/local-agent-host/shellUrl.ts";

/** The resolved inputs one attach run needs. */
export interface AttachConfig {
  shellUrl: string;
  sessionId: string;
  /** A pre-minted session-scoped token; present unless minting with `email`. */
  token?: string;
  /** Identity to mint (and refresh) a session-scoped token with, if no token. */
  email?: string;
  agent: string;
  command: AcpAgentCommand;
  cwd: string;
  name: string;
  template: string;
}

const OPTIONS = {
  url: { type: "string" },
  session: { type: "string" },
  token: { type: "string" },
  email: { type: "string" },
  agent: { type: "string" },
  cwd: { type: "string" },
  name: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

/** Whether the parsed flags only ask for help. */
export function wantsHelp(argv: string[]): boolean {
  const { values } = parseArgs({ args: argv, options: OPTIONS, strict: false });
  return values.help === true;
}

/** A flag value, falling back to an environment variable. */
function setting(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
  envName: string,
): string | undefined {
  const value = flag ?? env[envName];
  return value && value.length > 0 ? value : undefined;
}

/** Throws with `message` when `value` is missing. */
function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

/** The Shell URL, normalized to origin + mount path. */
function resolveShellUrl(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
): string {
  return normalizeShellUrl(
    required(
      setting(flag, env, "TANGENT_SHELL_URL"),
      "Set --url or TANGENT_SHELL_URL to the Tangent Shell URL.",
    ),
  );
}

/** The session id, from a raw id or a pasted session URL. */
function resolveSessionId(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
): string {
  return parseSessionRef(
    required(
      setting(flag, env, "TANGENT_SESSION_ID"),
      "Set --session to the session id or a pasted session URL.",
    ),
  );
}

/**
 * The attach credential, all optional: a pre-minted `token`, an `email` to mint
 * with, or neither — in which case the client self-mints, deriving identity from
 * the Oktasso cookie (prod) or the anonymous default (local dev).
 */
function resolveAuth(
  tokenFlag: string | undefined,
  emailFlag: string | undefined,
  env: NodeJS.ProcessEnv,
): { token?: string; email?: string } {
  const token = setting(tokenFlag, env, "TANGENT_ATTACH_TOKEN");
  const email = setting(emailFlag, env, "TANGENT_EMAIL");
  return { ...(token ? { token } : {}), ...(email ? { email } : {}) };
}

/** The agent to run, its working folder, and its roster name. */
function resolveRuntime(
  agentFlag: string | undefined,
  cwdFlag: string | undefined,
  nameFlag: string | undefined,
  env: NodeJS.ProcessEnv,
): { agent: string; cwd: string; name: string } {
  const agent = setting(agentFlag, env, "TANGENT_ACP_AGENT") ?? "claude";
  const cwd = resolve(setting(cwdFlag, env, "TANGENT_CWD") ?? ".");
  const name = nameFlag?.trim() || `${agent} (attached)`;
  return { agent, cwd, name };
}

/**
 * Parses attach flags (env-backed) into a resolved config. Needs a Shell URL, a
 * session (id or pasted URL), and an agent to run. Auth is optional: a pre-minted
 * `token`, an `email` to mint with, or neither (the client self-mints, deriving
 * identity from the Oktasso cookie or the anonymous default). The agent name
 * resolves to its ACP adapter command.
 */
export function parseAttachConfig(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): AttachConfig {
  const { values } = parseArgs({ args: argv, options: OPTIONS, strict: true });
  const shellUrl = resolveShellUrl(values.url, env);
  const sessionId = resolveSessionId(values.session, env);
  const auth = resolveAuth(values.token, values.email, env);
  const { agent, cwd, name } = resolveRuntime(
    values.agent,
    values.cwd,
    values.name,
    env,
  );
  return {
    shellUrl,
    sessionId,
    ...auth,
    agent,
    command: resolveAcpAgent(agent),
    cwd,
    name,
    template: `acp:${agent}`,
  };
}

/** The agent names with a built-in ACP command, for help text. */
export function knownAgents(): string[] {
  return acpAgentNames();
}
