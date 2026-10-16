import { statSync } from "node:fs";

import { LocalAgentBridge } from "@tangent/local-agent-host/bridge.ts";
import { createFileTools } from "@tangent/local-agent-host/remoteFileTools.ts";

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

function startBridge(config: CliConfig): LocalAgentBridge {
  let lastStatus = "";
  const bridge: LocalAgentBridge = new LocalAgentBridge({
    url: config.url,
    selector: config.selector,
    metadata: config.metadata,
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
  bridge.connect(config.token, config.environmentId);
  return bridge;
}

function main(): void {
  const config = parseCli(process.argv.slice(2), process.env);
  if (config === "help") {
    console.log(USAGE);
    return;
  }
  assertDirectory(config.launch.cwd);
  log(
    `connecting to ${config.url} as ${config.environmentId}, working in ${config.launch.cwd}`,
  );
  const bridge = startBridge(config);
  const stop = (signal: NodeJS.Signals): void => {
    log(`${signal}: stopping local sub-agents`);
    bridge.dispose();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`tangent-local-agent: ${message}\nRun with --help for usage.`);
  process.exitCode = 1;
}
