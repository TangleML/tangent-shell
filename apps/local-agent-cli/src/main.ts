import "@tangent/local-agent-host/loadEnv.ts";

import { statSync } from "node:fs";

import { LocalAgentBridge } from "@tangent/local-agent-host/bridge.ts";
import { peekOktassoCookie } from "@tangent/local-agent-host/oktasso.ts";
import { createOktassoFetch } from "@tangent/local-agent-host/oktassoFetch.ts";
import {
  mintRemoteEnvToken,
  type MintRemoteEnvTokenParams,
} from "@tangent/local-agent-host/remoteEnvToken.ts";
import { createFileTools } from "@tangent/local-agent-host/remoteFileTools.ts";
import { startTokenRefresh } from "@tangent/local-agent-host/tokenRefresh.ts";

import { type CliConfig, parseCli } from "./config.ts";
import { USAGE } from "./usage.ts";

function log(line: string): void {
  console.log(`${new Date().toISOString()} ${line}`);
}

function assertDirectory(dir: string): void {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Not a directory: ${dir}`);
  }
}

function statusLine(bridge: LocalAgentBridge): string {
  return `status: ${bridge.state}, ${bridge.listAgents().length} sub-agent(s)`;
}

/**
 * Splits the Shell URL into the origin and the engine.io path, so a
 * mounted-prefix deployment (e.g. `https://host/api/.../ports/8000`) reaches
 * the right socket.io endpoint (`<mount>/socket.io`) and the `/remote-env`
 * namespace, instead of the origin root.
 */
function socketTarget(shellUrl: string): { url: string; socketPath: string } {
  const url = new URL(shellUrl);
  const mount = url.pathname.replace(/\/+$/, "");
  return { url: url.origin, socketPath: `${mount}/socket.io` };
}

function createBridge(
  config: CliConfig,
  extraHeaders: () => Record<string, string> | undefined,
): LocalAgentBridge {
  let lastStatus = "";
  const socket = socketTarget(config.url);
  const bridge: LocalAgentBridge = new LocalAgentBridge({
    url: socket.url,
    socketPath: socket.socketPath,
    selector: config.selector,
    metadata: config.metadata,
    extraHeaders,
    tools: createFileTools(() => config.launch.cwd),
    piLaunchOptions: () => Promise.resolve(config.launch),
    log,
    onChange: () => {
      const status = statusLine(bridge);
      if (status === lastStatus) return;
      lastStatus = status;
      log(status);
    },
    onSpawned: (agent) =>
      log(`sub-agent "${agent.name}" (${agent.agentId}) started`),
  });
  return bridge;
}

/** Mint params that self-mint a scoped token using the SSO cookie or `email`. */
function mintParams(
  config: CliConfig,
  fetchImpl: typeof fetch,
): MintRemoteEnvTokenParams {
  return {
    shellUrl: config.url,
    ...(config.sessionId
      ? { sessionId: config.sessionId }
      : { selector: config.selector }),
    environmentId: config.environmentId,
    ...(config.email ? { email: config.email } : {}),
    fetchImpl,
  };
}

async function main(): Promise<void> {
  const config = parseCli(process.argv.slice(2), process.env);
  if (config === "help") {
    console.log(USAGE);
    return;
  }
  assertDirectory(config.launch.cwd);
  log(
    `connecting to ${config.url} as ${config.environmentId}, working in ${config.launch.cwd}`,
  );
  const shellOrigin = new URL(config.url).origin;
  const oktassoFetch = createOktassoFetch(shellOrigin);
  const params = mintParams(config, oktassoFetch);
  const minted = await mintRemoteEnvToken(params);
  let cookie = await peekOktassoCookie(shellOrigin);
  const bridge = createBridge(config, () => (cookie ? { cookie } : undefined));
  bridge.connect(minted.token, minted.environmentId);
  const stopRefresh = startTokenRefresh(
    {
      mintParams: { ...params, environmentId: minted.environmentId },
      applyToken: async (token) => {
        cookie = (await peekOktassoCookie(shellOrigin)) ?? cookie;
        bridge.connect(token, minted.environmentId);
      },
      log,
    },
    minted.expiresAtMs,
  );
  const stop = (signal: NodeJS.Signals): void => {
    log(`${signal}: stopping local sub-agents`);
    stopRefresh();
    bridge.dispose();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`tangent-local-agent: ${message}\nRun with --help for usage.`);
  process.exitCode = 1;
});
