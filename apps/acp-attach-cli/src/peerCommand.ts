import { parseArgs } from "node:util";

import { peerSocketPath } from "@tangent/acp-attach-host/peerMailbox.ts";
import { runPeerMcpServer } from "@tangent/acp-attach-host/peerMcpServer.ts";
import { peerSend, peerWait } from "@tangent/acp-attach-host/peerSocket.ts";
import { runPrimeMcpServer } from "@tangent/acp-attach-host/primeMcpServer.ts";
import { runResourceMcpServer } from "@tangent/acp-attach-host/resourceMcpServer.ts";
import { parseSessionRef } from "@tangent/local-agent-host/shellUrl.ts";

/** Seconds a `peer wait` blocks before printing `timeout`, if none is given. */
const DEFAULT_WAIT_SECONDS = 300;

const PEER_OPTIONS = {
  session: { type: "string" },
  text: { type: "string" },
  timeout: { type: "string" },
} as const;

/** The session whose mailbox to reach, from `--session` or the environment. */
function resolveSession(flag: string | undefined): string {
  const value = flag ?? process.env.TANGENT_SESSION_ID;
  if (!value) {
    throw new Error("Set --session (or TANGENT_SESSION_ID) to the session id.");
  }
  return parseSessionRef(value);
}

/**
 * The launcher side of the peer channel: `peer send --text ...` queues a message
 * for the attached agent, `peer wait` blocks for its reply. Both find the
 * mailbox socket from the session id, the same path the running attach serves.
 */
export async function runPeerCommand(argv: string[]): Promise<void> {
  const op = argv[0];
  const { values } = parseArgs({
    args: argv.slice(1),
    options: PEER_OPTIONS,
    strict: true,
  });
  const socketPath = peerSocketPath(resolveSession(values.session));
  if (op === "send") return sendCommand(socketPath, values.text);
  if (op === "wait") return waitCommand(socketPath, values.timeout);
  throw new Error(`Unknown peer command: ${String(op)}. Use "send" or "wait".`);
}

async function sendCommand(
  socketPath: string,
  text: string | undefined,
): Promise<void> {
  if (!text) throw new Error("peer send needs --text.");
  const queued = await peerSend(socketPath, "parent", text);
  if (queued) {
    console.log("queued");
    return;
  }
  console.log("not attached");
  process.exitCode = 1;
}

async function waitCommand(
  socketPath: string,
  timeout: string | undefined,
): Promise<void> {
  const seconds = timeout ? Number(timeout) : DEFAULT_WAIT_SECONDS;
  const message = await peerWait(socketPath, "agent", seconds * 1_000);
  console.log(message ? message.text : "timeout");
}

/** The mailbox socket, from the `--socket` arg or the env var fallback. */
function resolvePeerSocket(argv: string[]): string | undefined {
  const { values } = parseArgs({
    args: argv,
    options: { socket: { type: "string" } },
    strict: false,
  });
  const fromArg = typeof values.socket === "string" ? values.socket : undefined;
  return fromArg || process.env.TANGENT_ACP_PEER_SOCK || undefined;
}

/**
 * The MCP-server side, launched by the attached agent to reach its launcher.
 * The server always starts — even without a socket path — so a misconfigured
 * launch answers tool calls with an error instead of leaving the agent spinning
 * on a request that never returns.
 */
export function runPeerMcp(argv: string[]): void {
  const socketPath = resolvePeerSocket(argv);
  if (!socketPath) {
    console.error(
      "[peer-mcp] no mailbox socket (--socket or TANGENT_ACP_PEER_SOCK); peer tools will report the launcher as unreachable.",
    );
  }
  runPeerMcpServer({ socketPath: socketPath ?? "" });
}

/** A string flag value, else the named env var, else an empty string. */
function flagOrEnv(value: unknown, envName: string): string {
  const flag = typeof value === "string" ? value : "";
  return flag || process.env[envName] || "";
}

/** The loopback host API url + token, from args or the env var fallback. */
function resolveHostApi(argv: string[]): { url: string; token: string } {
  const { values } = parseArgs({
    args: argv,
    options: {
      "host-api-url": { type: "string" },
      "host-api-token": { type: "string" },
    },
    strict: false,
  });
  return {
    url: flagOrEnv(values["host-api-url"], "TANGENT_HOST_API_URL"),
    token: flagOrEnv(values["host-api-token"], "TANGENT_HOST_API_TOKEN"),
  };
}

/**
 * The session-resource MCP server, launched by the attached agent to contribute
 * and read session resources. Always starts — even without a host API — so a
 * misconfigured launch answers tool calls with an error instead of leaving the
 * agent hanging on a request that never returns.
 */
export function runResourceMcp(argv: string[]): void {
  const { url, token } = resolveHostApi(argv);
  if (!url) {
    console.error(
      "[resource-mcp] no host API (--host-api-url or TANGENT_HOST_API_URL); session-resource tools will report resources as unavailable.",
    );
  }
  runResourceMcpServer({ hostApiUrl: url, hostApiToken: token });
}

/**
 * The Prime MCP server, launched by the attached agent to reach Prime
 * proactively. Always starts — even without a host API — so a misconfigured
 * launch answers tool calls with an error instead of leaving the agent hanging
 * on a request that never returns.
 */
export function runPrimeMcp(argv: string[]): void {
  const { url, token } = resolveHostApi(argv);
  if (!url) {
    console.error(
      "[prime-mcp] no host API (--host-api-url or TANGENT_HOST_API_URL); message_prime will report Prime as unreachable.",
    );
  }
  runPrimeMcpServer({ hostApiUrl: url, hostApiToken: token });
}
