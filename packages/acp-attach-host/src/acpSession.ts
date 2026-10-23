import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";

import {
  type ActiveSession,
  type AnyMessage,
  client,
  type ClientContext,
  type InitializeResponse,
  type McpServer,
  methods,
  ndJsonStream,
  type PromptResponse,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type Stream,
  type SystemPrompt,
} from "@agentclientprotocol/sdk";

import type { AcpAgentCommand } from "./acpAgents.ts";
import { CONSUMED_SESSION_UPDATES } from "./eventMapping.ts";

/** What streams out of a running ACP agent, and how its process ended. */
export interface AcpSessionCallbacks {
  onUpdate(update: SessionNotification["update"]): void;
  onLog(line: string): void;
  /** Fires once, whether the process exited or failed to start. */
  onExit(reason: string): void;
}

export interface AcpSessionOptions {
  command: AcpAgentCommand;
  /** The folder the agent works in; its session is opened here. */
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** MCP servers the agent's session is opened with. */
  mcpServers?: McpServer[];
  /**
   * System instructions appended to the agent's own, sent only when the agent
   * advertises the (unstable) `systemPrompt` session capability — others would
   * reject it, so it is dropped silently for them.
   */
  systemPrompt?: SystemPrompt;
}

/**
 * Auto-allows a permission prompt within the working folder — a v1 that runs the
 * agent with its own default authority, the way a local host grants a pi
 * sub-agent. Falls back to cancelling when the agent offers no allow option.
 */
function autoAllow(
  params: RequestPermissionRequest,
): RequestPermissionResponse {
  const option =
    params.options.find((o) => o.kind === "allow_once") ??
    params.options.find((o) => o.kind === "allow_always");
  if (!option) return { outcome: { outcome: "cancelled" } };
  return { outcome: { outcome: "selected", optionId: option.optionId } };
}

/**
 * A `session/update` notification for a kind {@link TurnStreamer} never consumes.
 * The agent emits many such updates (usage, session info, ...) whose shape can
 * outrun this SDK's schema; dropping them before the SDK validates avoids noisy
 * "Invalid params" errors without losing anything the bridge would have used.
 */
function isUnsupportedUpdate(message: AnyMessage): boolean {
  if (!("method" in message)) return false;
  if (message.method !== methods.client.session.update) return false;
  const kind = (message.params as SessionNotification | undefined)?.update
    ?.sessionUpdate;
  return typeof kind === "string" && !CONSUMED_SESSION_UPDATES.has(kind);
}

/** The same stream with unconsumed `session/update` notifications filtered out. */
function withSupportedUpdates(stream: Stream): Stream {
  return {
    writable: stream.writable,
    readable: stream.readable.pipeThrough(
      new TransformStream<AnyMessage, AnyMessage>({
        transform(message, controller) {
          if (!isUnsupportedUpdate(message)) controller.enqueue(message);
        },
      }),
    ),
  };
}

/**
 * One locally-spawned coding agent driven over ACP (JSON-RPC on stdio). This is
 * the ACP *client* side: it launches the adapter subprocess, negotiates the
 * protocol, opens a session in `cwd`, and runs one prompt turn at a time. A turn
 * streams through {@link AcpSessionCallbacks.onUpdate} and resolves with the
 * agent's stop reason.
 *
 * The SDK's v1 client is pull-based: {@link start} opens the connection and
 * holds it in a single async scope for the session's lifetime, while
 * {@link prompt} fires a turn and drains the session's update queue until it
 * stops. File reads/writes hit the local disk (the agent and this bridge share
 * it), and every permission prompt is auto-allowed within the working folder.
 */
export class AcpSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly cwd: string;
  private readonly callbacks: AcpSessionCallbacks;
  private readonly mcpServers: McpServer[];
  private readonly systemPrompt?: SystemPrompt;
  private exited = false;

  private readonly ready: Promise<ActiveSession>;
  private resolveReady!: (session: ActiveSession) => void;
  private readonly closed: Promise<void>;
  private closeSession!: () => void;
  private ctx?: ClientContext;
  private session?: ActiveSession;

  constructor(options: AcpSessionOptions, callbacks: AcpSessionCallbacks) {
    this.cwd = options.cwd;
    this.callbacks = callbacks;
    this.mcpServers = options.mcpServers ?? [];
    this.systemPrompt = options.systemPrompt;
    this.ready = new Promise((resolve) => (this.resolveReady = resolve));
    this.closed = new Promise((resolve) => (this.closeSession = resolve));

    this.child = spawn(options.command.bin, options.command.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
    });
    this.child.stderr.on("data", (chunk: Buffer) =>
      callbacks.onLog(`stderr ${chunk.toString("utf8").trimEnd()}`),
    );
    this.child.on("error", (err) => this.finish(`failed: ${err.message}`));
    this.child.on("exit", (code, signal) =>
      this.finish(`exited (${signal ?? `code ${code}`})`),
    );

    this.connect();
  }

  /** Negotiates the ACP connection over the child's stdio and holds it open. */
  private connect(): void {
    const stream = withSupportedUpdates(
      ndJsonStream(
        Writable.toWeb(
          this.child.stdin,
        ) as unknown as WritableStream<Uint8Array>,
        Readable.toWeb(
          this.child.stdout,
        ) as unknown as ReadableStream<Uint8Array>,
      ),
    );

    void client({ name: "tangent-acp-attach" })
      .onRequest(methods.client.session.requestPermission, (ctx) =>
        autoAllow(ctx.params),
      )
      .onRequest(methods.client.fs.readTextFile, async (ctx) => ({
        content: await readFile(ctx.params.path, "utf8"),
      }))
      .onRequest(methods.client.fs.writeTextFile, async (ctx) => {
        await writeFile(ctx.params.path, ctx.params.content, "utf8");
        return {};
      })
      .connectWith(stream, (ctx) => this.openSession(ctx))
      .catch((err: unknown) => this.finish(`failed: ${message(err)}`));
  }

  /** Initializes the agent, opens its session, and keeps it until closed. */
  private async openSession(ctx: ClientContext): Promise<void> {
    this.ctx = ctx;
    const initialize = await ctx.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    });
    await ctx
      .buildSession({
        cwd: this.cwd,
        mcpServers: this.mcpServers,
        ...this.systemPromptFor(initialize),
      })
      .withSession(async (session) => {
        this.session = session;
        this.resolveReady(session);
        await this.closed;
      });
  }

  /**
   * The `systemPrompt` field for `session/new`, included only when the agent
   * advertises the capability — others reject an unexpected system prompt.
   */
  private systemPromptFor(initialize: InitializeResponse): {
    systemPrompt?: SystemPrompt;
  } {
    if (!this.systemPrompt) return {};
    const supported =
      initialize.agentCapabilities?.sessionCapabilities?.systemPrompt != null;
    return supported ? { systemPrompt: this.systemPrompt } : {};
  }

  /** Negotiates the protocol and opens the agent's session in `cwd`. */
  async start(): Promise<void> {
    await this.ready;
  }

  /** Runs one prompt turn, streaming updates and resolving its stop reason. */
  async prompt(text: string): Promise<PromptResponse["stopReason"]> {
    const session = await this.ready;
    void session.prompt(text);
    for (;;) {
      const message = await session.nextUpdate();
      if (message.kind === "stop") return message.response.stopReason;
      this.callbacks.onUpdate(message.update);
    }
  }

  /** Asks the agent to cancel the turn in flight. */
  async cancel(): Promise<void> {
    if (this.ctx && this.session) {
      await this.ctx.notify(methods.agent.session.cancel, {
        sessionId: this.session.sessionId,
      });
    }
  }

  /** Ends the session scope and terminates the agent process. */
  dispose(): void {
    this.closeSession();
    if (!this.exited) this.child.kill("SIGTERM");
  }

  private finish(reason: string): void {
    this.closeSession();
    if (this.exited) return;
    this.exited = true;
    this.callbacks.onExit(reason);
  }
}

/** The message of an unknown error. */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
