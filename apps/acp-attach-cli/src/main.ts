import "@tangent/local-agent-host/loadEnv.ts";

import { AttachClient } from "@tangent/acp-attach-host/attachClient.ts";
import { AttachBridge } from "@tangent/acp-attach-host/bridge.ts";
import {
  PeerMailbox,
  peerSocketPath,
} from "@tangent/acp-attach-host/peerMailbox.ts";
import { isPeerSocketAlive } from "@tangent/acp-attach-host/peerSocket.ts";
import { createOktassoFetch } from "@tangent/local-agent-host/oktassoFetch.ts";
import { mintRemoteEnvToken } from "@tangent/local-agent-host/remoteEnvToken.ts";
import { startTokenRefresh } from "@tangent/local-agent-host/tokenRefresh.ts";

import { type AttachConfig, parseAttachConfig, wantsHelp } from "./config.ts";
import {
  runPeerCommand,
  runPeerMcp,
  runPrimeMcp,
  runResourceMcp,
} from "./peerCommand.ts";
import { usage } from "./usage.ts";

function log(line: string): void {
  console.error(`[acp-attach] ${line}`);
}

/** The peer config for one attach: a mailbox served on the session's socket. */
function peerConfig(sessionId: string) {
  return {
    mailbox: new PeerMailbox(),
    socketPath: peerSocketPath(sessionId),
    mcpCommand: { bin: process.execPath, args: [process.argv[1], "peer-mcp"] },
  };
}

/** The session-resource config: how the bridge launches the resource MCP server. */
function resourceConfig() {
  return {
    mcpCommand: {
      bin: process.execPath,
      args: [process.argv[1], "resource-mcp"],
    },
  };
}

/** The Prime config: how the bridge launches the Prime MCP server. */
function primeConfig() {
  return {
    mcpCommand: {
      bin: process.execPath,
      args: [process.argv[1], "prime-mcp"],
    },
  };
}

/** The initial token: the pre-minted one, or a fresh session-scoped mint. */
async function acquireToken(
  config: AttachConfig,
  fetchImpl: typeof fetch,
): Promise<{ token: string; expiresAtMs?: number }> {
  if (config.token) return { token: config.token };
  const minted = await mintRemoteEnvToken({
    shellUrl: config.shellUrl,
    sessionId: config.sessionId,
    ...(config.email ? { email: config.email } : {}),
    fetchImpl,
  });
  return {
    token: minted.token,
    ...(minted.expiresAtMs ? { expiresAtMs: minted.expiresAtMs } : {}),
  };
}

async function run(config: AttachConfig): Promise<void> {
  const peer = peerConfig(config.sessionId);
  if (await isPeerSocketAlive(peer.socketPath)) {
    log(`already attached to session ${config.sessionId}; leaving it be.`);
    return;
  }
  const oktassoFetch = createOktassoFetch(new URL(config.shellUrl).origin);
  const { token, expiresAtMs } = await acquireToken(config, oktassoFetch);
  const client = new AttachClient({
    shellUrl: config.shellUrl,
    token,
    sessionId: config.sessionId,
    fetch: oktassoFetch,
  });
  const stopRefresh = config.token
    ? () => {}
    : startTokenRefresh(
        {
          mintParams: {
            shellUrl: config.shellUrl,
            sessionId: config.sessionId,
            ...(config.email ? { email: config.email } : {}),
            fetchImpl: oktassoFetch,
          },
          applyToken: (token) => client.setToken(token),
          log,
        },
        expiresAtMs,
      );

  const bridge = new AttachBridge({
    client,
    command: config.command,
    cwd: config.cwd,
    name: config.name,
    template: config.template,
    peer,
    resources: resourceConfig(),
    prime: primeConfig(),
    log,
  });

  const shutdown = async (): Promise<void> => {
    stopRefresh();
    await bridge.dispose();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  log(
    `attaching ${config.agent} to session ${config.sessionId} at ${config.shellUrl}`,
  );
  await bridge.start();
  log(
    `attached as ${bridge.attachedAgentId}; waiting for Prime. Ctrl-C to detach.`,
  );
}

/** The non-attach entry points, dispatched by the first argument. */
const SUBCOMMANDS: Record<string, (argv: string[]) => void | Promise<void>> = {
  peer: (argv) => runPeerCommand(argv),
  "peer-mcp": (argv) => runPeerMcp(argv),
  "resource-mcp": (argv) => runResourceMcp(argv),
  "prime-mcp": (argv) => runPrimeMcp(argv),
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const subcommand = SUBCOMMANDS[argv[0] ?? ""];
  if (subcommand) return subcommand(argv.slice(1));
  if (wantsHelp(argv)) {
    console.log(usage());
    return;
  }
  let config: AttachConfig;
  try {
    config = parseAttachConfig(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(`\n${usage()}`);
    process.exitCode = 1;
    return;
  }
  await run(config);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
