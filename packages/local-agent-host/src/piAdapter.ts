import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

import type { MessageDelivery } from "@tangent/shared/contracts.ts";
import type {
  RemoteAgentEvent,
  RemoteSpawnCommand,
} from "@tangent/shared/remoteSubagent.ts";

import {
  createStreamState,
  parsePiLine,
  translatePiEvent,
} from "./piEvents.ts";

/** How a local pi process is launched. */
export interface PiLaunchOptions {
  bin: string;
  /** Working directory; sub-agents are refused when no folder is open. */
  cwd?: string;
  /** Overrides the model Prime asked for. */
  model?: string;
  proxyUrl?: string;
  proxyApiKey?: string;
  /** The bundled proxy-provider extension, loaded only with `proxyUrl`. */
  proxyExtensionPath: string;
  /** The bundled session-resources extension, loaded only with `hostApiUrl`. */
  sessionResourceExtensionPath?: string;
  /** Loopback host API the session-resources extension calls back into. */
  hostApiUrl?: string;
  /** Bearer token guarding {@link hostApiUrl}. */
  hostApiToken?: string;
}

export interface PiAgentCallbacks {
  onEvent(event: RemoteAgentEvent): void;
  /** Fires once, whether the process exited or failed to start. */
  onExit(reason: string): void;
  onLog(line: string): void;
}

function modelArgs(
  command: RemoteSpawnCommand,
  options: PiLaunchOptions,
): string[] {
  const args: string[] = [];
  const model = options.model ?? command.model;
  if (model) args.push("--model", model);
  if (command.thinkingDepth) args.push("--thinking", command.thinkingDepth);
  return args;
}

/**
 * The `pi --mode rpc` arguments for a spawn. A local host runs on the user's
 * own machine, so - unlike the server's sandboxed launcher - it grants pi its
 * full default capabilities: no `--tools` allowlist (all built-in, MCP, and
 * extension-registered tools stay enabled) and no `--no-skills` (skills, the
 * user's installed extensions, prompt templates, themes, and context files all
 * auto-discover). The Tangent proxy + session-resource extensions layer on top.
 */
export function buildPiArgs(
  command: RemoteSpawnCommand,
  options: PiLaunchOptions,
): string[] {
  const args = [
    "--mode",
    "rpc",
    "--no-session",
    ...modelArgs(command, options),
  ];
  if (command.systemPrompt) {
    args.push("--append-system-prompt", command.systemPrompt);
  }
  if (options.proxyUrl) args.push("--extension", options.proxyExtensionPath);
  if (options.hostApiUrl && options.sessionResourceExtensionPath) {
    args.push("--extension", options.sessionResourceExtensionPath);
  }
  return args;
}

export function piEnv(
  command: RemoteSpawnCommand,
  options: PiLaunchOptions,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.proxyUrl) env.PI_PROXY_URL = options.proxyUrl;
  if (options.proxyApiKey) env.PI_PROXY_API_KEY = options.proxyApiKey;
  if (options.hostApiUrl) {
    env.TANGENT_HOST_API_URL = options.hostApiUrl;
    env.TANGENT_HOST_API_TOKEN = options.hostApiToken ?? "";
    env.TANGENT_SESSION_ID = command.sessionId;
    env.TANGENT_AGENT_ID = command.agentId;
  }
  return env;
}

/** Splits a stream into LF-delimited lines (not `readline`, which also splits on U+2028). */
function onLines(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): void {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  stream.on("data", (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.replace(/\r$/, "");
      if (trimmed) onLine(trimmed);
    }
  });
}

/** One long-lived local `pi --mode rpc` child driven over stdin/stdout JSONL. */
export class PiAgent {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly callbacks: PiAgentCallbacks;
  private readonly state = createStreamState();
  private busy = false;
  private exited = false;

  constructor(
    command: RemoteSpawnCommand,
    options: PiLaunchOptions,
    callbacks: PiAgentCallbacks,
  ) {
    this.callbacks = callbacks;
    this.child = spawn(options.bin, buildPiArgs(command, options), {
      cwd: options.cwd,
      env: piEnv(command, options),
    });
    onLines(this.child.stdout, (line) => this.handleLine(line));
    onLines(this.child.stderr, (line) => callbacks.onLog(`stderr ${line}`));
    this.child.stdin.on("error", (err) =>
      callbacks.onLog(`stdin ${err.message}`),
    );
    this.child.on("error", (err) => this.finish(`failed: ${err.message}`));
    this.child.on("exit", (code, signal) =>
      this.finish(`exited (${signal ?? `code ${code}`})`),
    );
  }

  /** Sends a prompt; mid-run it steers or queues according to `delivery`. */
  prompt(text: string, delivery: MessageDelivery): void {
    const streamingBehavior = delivery === "steer" ? "steer" : "followUp";
    this.write({
      id: randomUUID(),
      type: "prompt",
      message: text,
      ...(this.busy ? { streamingBehavior } : {}),
    });
    this.busy = true;
  }

  kill(): void {
    if (!this.exited) this.child.kill("SIGTERM");
  }

  private write(command: Record<string, unknown>): void {
    if (this.exited) return;
    this.child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  private handleLine(line: string): void {
    const event = parsePiLine(line);
    if (!event) {
      this.callbacks.onLog(`unparseable ${line}`);
      return;
    }
    if (event.type === "agent_end") this.busy = false;
    try {
      for (const out of translatePiEvent(this.state, event, randomUUID)) {
        this.callbacks.onEvent(out);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.callbacks.onLog(`translate failed ${message}`);
    }
  }

  private finish(reason: string): void {
    if (this.exited) return;
    this.exited = true;
    this.busy = false;
    this.callbacks.onExit(reason);
  }
}
