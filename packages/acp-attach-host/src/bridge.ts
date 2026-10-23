import type {
  McpServer,
  SessionNotification,
  SystemPrompt,
} from "@agentclientprotocol/sdk";
import {
  type HostApi,
  type HostApiRoutes,
  startHostApi,
} from "@tangent/local-agent-host/hostApi.ts";
import type {
  RemoteAgentEvent,
  RemoteResourceInput,
} from "@tangent/shared/remoteSubagent.ts";

import type { AcpAgentCommand } from "./acpAgents.ts";
import { AcpSession, type AcpSessionOptions } from "./acpSession.ts";
import {
  type AttachClient,
  type AttachDelivery,
  type AttachRunStatus,
} from "./attachClient.ts";
import { TurnStreamer } from "./eventMapping.ts";
import type { PeerMailbox } from "./peerMailbox.ts";
import { createPeerServer, type PeerServer } from "./peerSocket.ts";

/** Env vars the session-resource MCP server reads the loopback host API from. */
const RESOURCE_URL_ENV = "TANGENT_HOST_API_URL";
const RESOURCE_TOKEN_ENV = "TANGENT_HOST_API_TOKEN";

/** Backoff after a failed deliveries poll, so a down Shell is not hammered. */
const RETRY_MS = 3_000;

/** Env var the peer MCP server reads its mailbox socket path from. */
const DEFAULT_PEER_ENV = "TANGENT_ACP_PEER_SOCK";

/** Orients the agent: it is a Tangent sub-agent that Prime orchestrates. */
const PRIME_SYSTEM_PROMPT = [
  "You are a sub-agent in a Tangent session led by Prime, the orchestrator.",
  "Prime delegates work to you: each task arrives as a normal turn, and your",
  "reply to that turn is your report back to Prime — that is how Prime sees",
  "your results, so answer in full rather than assuming it goes unread.",
].join(" ");

/** The extra line naming the proactive channel, when the prime tool is wired. */
const PRIME_TOOL_PROMPT = [
  "To reach Prime at any other time — a proactive update, a blocker, a",
  'question — use the "tangent-prime" MCP server: message_prime({ text })',
  "posts a message to Prime in this session.",
].join(" ");

/** Appended to the agent's own instructions so it knows about its launcher. */
const PEER_SYSTEM_PROMPT = [
  "A launcher agent (your peer) attached you to this session from the same",
  'machine. Talk to it with the tools from the "tangent-peer" MCP server:',
  "peer_send({ text }) sends it a message, peer_wait({ timeoutMs }) waits for",
  "its next one. A message from the launcher arrives as a normal turn; answer",
  "by calling peer_send. Reach for peer_wait only when you are waiting on it.",
].join(" ");

/** Wraps a Prime directive so the agent reads it as coming from Prime. */
function primePrompt(text: string): string {
  return `Message from Prime, the session orchestrator. Your reply to this turn goes back to Prime.\n\n${text}`;
}

/** Wraps a launcher message so the agent reads it as coming from its peer. */
function peerPrompt(text: string): string {
  return `Message from your launcher (your peer). Reply with the peer_send tool.\n\n${text}`;
}

/** How the agent's stop reason settles the turn's Run. */
function runStatus(stopReason: string): AttachRunStatus {
  if (stopReason === "cancelled") return "cancelled";
  if (stopReason === "refusal") return "failed";
  return "completed";
}

/** A seam so tests can stand in for a live ACP subprocess. */
export type AcpSessionFactory = (
  options: AcpSessionOptions,
  callbacks: ConstructorParameters<typeof AcpSession>[1],
) => AcpSession;

/** Wires the attached agent a session-resource MCP server. */
export interface AttachResourceConfig {
  /** How to launch the session-resource MCP server subprocess. */
  mcpCommand: AcpAgentCommand;
}

/** Wires the attached agent a Prime MCP server for proactive reports. */
export interface AttachPrimeConfig {
  /** How to launch the Prime MCP server subprocess. */
  mcpCommand: AcpAgentCommand;
}

/** The local channel that lets the launcher and the attached agent talk. */
export interface AttachPeerConfig {
  /** The shared queues both ends meet on; the bridge drains `parent` here. */
  mailbox: PeerMailbox;
  /** When set, the bridge serves the mailbox here for out-of-process peers. */
  socketPath?: string;
  /** When set, the attached agent is given a peer MCP server launched this way. */
  mcpCommand?: AcpAgentCommand;
  /** Env var the MCP server reads the socket path from. Defaults to a constant. */
  socketEnvName?: string;
}

export interface AttachBridgeOptions {
  client: AttachClient;
  command: AcpAgentCommand;
  cwd: string;
  /** The roster name the attached agent shows under. */
  name: string;
  /** An informational template label, e.g. `acp:claude`. */
  template?: string;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  /** Wires a local channel to the launcher; omitted, the agent runs alone. */
  peer?: AttachPeerConfig;
  /** Gives the agent session-resource tools; omitted, it contributes none. */
  resources?: AttachResourceConfig;
  /** Gives the agent a message_prime tool; omitted, it has no proactive line. */
  prime?: AttachPrimeConfig;
  /** Test seam; defaults to spawning a real {@link AcpSession}. */
  createSession?: AcpSessionFactory;
  /** Test seam for the loopback host API; defaults to {@link startHostApi}. */
  startHostApi?: typeof startHostApi;
}

/**
 * Joins a locally-run ACP agent into a Tangent session. On {@link start} it
 * registers a tab, opens the agent's ACP session, then loops: it long-polls the
 * attach API for Prime's next directive, runs it as one ACP prompt turn, and
 * streams the turn's output back as Tangent agent events against a Run it opens
 * and settles. The agent's process exiting ends the attachment.
 *
 * One turn runs at a time — the loop awaits each before taking the next — so a
 * tab's Runs stay serial the way every other connector's do.
 */
export class AttachBridge {
  private readonly client: AttachClient;
  private readonly command: AcpAgentCommand;
  private readonly cwd: string;
  private readonly name: string;
  private readonly template?: string;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly log: (line: string) => void;
  private readonly peer?: AttachPeerConfig;
  private readonly mailbox?: PeerMailbox;
  private readonly resources?: AttachResourceConfig;
  private readonly prime?: AttachPrimeConfig;
  private readonly createSession: AcpSessionFactory;
  private readonly startApi: typeof startHostApi;

  private session?: AcpSession;
  private peerServer?: PeerServer;
  private hostApi?: HostApi;
  private agentId?: string;
  private turn?: TurnStreamer;
  private runId?: string;
  private pollInFlight?: Promise<AttachDelivery[] | undefined>;
  private pollAbort?: AbortController;
  private pushChain: Promise<void> = Promise.resolve();
  private running = false;
  private stopped = false;

  constructor(options: AttachBridgeOptions) {
    this.client = options.client;
    this.command = options.command;
    this.cwd = options.cwd;
    this.name = options.name;
    this.template = options.template;
    this.env = options.env;
    this.log = options.log ?? (() => {});
    this.peer = options.peer;
    this.mailbox = options.peer?.mailbox;
    this.resources = options.resources;
    this.prime = options.prime;
    this.createSession =
      options.createSession ??
      ((sessionOptions, callbacks) =>
        new AcpSession(sessionOptions, callbacks));
    this.startApi = options.startHostApi ?? startHostApi;
  }

  /** The server-assigned id of the attached agent, once registered. */
  get attachedAgentId(): string | undefined {
    return this.agentId;
  }

  /** Registers the tab, opens the agent's session, and starts the loop. */
  async start(): Promise<void> {
    this.agentId = await this.client.register(this.name, this.template);
    await this.serveMailbox();
    await this.serveResources();
    this.session = this.createSession(
      {
        command: this.command,
        cwd: this.cwd,
        env: this.env,
        mcpServers: [
          ...this.peerMcpServers(),
          ...this.resourceMcpServers(),
          ...this.primeMcpServers(),
        ],
        systemPrompt: this.systemPrompt(),
      },
      {
        onUpdate: (update) => this.onUpdate(update),
        onLog: (line) => this.log(line),
        onExit: (reason) => this.onExit(reason),
      },
    );
    await this.session.start();
    this.running = true;
    void this.loop();
  }

  /** Starts the socket server when a peer path is configured. */
  private async serveMailbox(): Promise<void> {
    if (!this.peer?.socketPath || !this.mailbox) return;
    this.peerServer = await createPeerServer(
      this.peer.socketPath,
      this.mailbox,
    );
  }

  /** Starts the loopback host API when session resources are configured. */
  private async serveResources(): Promise<void> {
    if (!this.resources) return;
    this.hostApi = await this.startApi(this.resourceRoutes());
  }

  /**
   * The loopback routes the session-resource MCP server calls, each forwarding
   * to the live attach client so its (refreshing) token carries the request. The
   * bridge supplies the attributed agent id; a dropped attach surfaces clearly.
   */
  private resourceRoutes(): HostApiRoutes {
    const agentId = (): string => {
      if (!this.agentId) throw new Error("Not attached to the session.");
      return this.agentId;
    };
    return {
      put: async (body) => {
        const { input } = body as { input: RemoteResourceInput };
        return this.client.addResource(agentId(), input);
      },
      list: async () => this.client.listResources(),
      read: async (body) => {
        const { uri } = body as { uri: string };
        return this.client.readResource(uri);
      },
      report: async (body) => {
        const { text } = body as { text: string };
        await this.client.reportToPrime(agentId(), text);
        return { delivered: true };
      },
    };
  }

  /**
   * The session-resource MCP server for the agent's session, or none when
   * unconfigured. The loopback url + token ride on both args and env, matching
   * the peer server's dual channel since agents forward args more reliably than
   * an MCP server's configured env.
   */
  private resourceMcpServers(): McpServer[] {
    const resources = this.resources;
    const hostApi = this.hostApi;
    if (!resources || !hostApi) return [];
    return [
      {
        name: "tangent-session-resources",
        command: resources.mcpCommand.bin,
        args: [
          ...resources.mcpCommand.args,
          "--host-api-url",
          hostApi.url,
          "--host-api-token",
          hostApi.token,
        ],
        env: [
          { name: RESOURCE_URL_ENV, value: hostApi.url },
          { name: RESOURCE_TOKEN_ENV, value: hostApi.token },
        ],
      },
    ];
  }

  /**
   * The Prime MCP server for the agent's session, or none when unconfigured. It
   * rides the same loopback host API as the resource server — one `/report`
   * route carries the proactive message — so the url + token travel on both args
   * and env exactly as the resource server's do.
   */
  private primeMcpServers(): McpServer[] {
    const prime = this.prime;
    const hostApi = this.hostApi;
    if (!prime || !hostApi) return [];
    return [
      {
        name: "tangent-prime",
        command: prime.mcpCommand.bin,
        args: [
          ...prime.mcpCommand.args,
          "--host-api-url",
          hostApi.url,
          "--host-api-token",
          hostApi.token,
        ],
        env: [
          { name: RESOURCE_URL_ENV, value: hostApi.url },
          { name: RESOURCE_TOKEN_ENV, value: hostApi.token },
        ],
      },
    ];
  }

  /**
   * The peer MCP server for the agent's session, or none when unconfigured. The
   * mailbox socket path rides on both a `--socket` arg and an env var: agents
   * reliably forward launch args, but not every one passes the MCP server's
   * configured `env` through to the subprocess, so the arg is the primary channel.
   */
  private peerMcpServers(): McpServer[] {
    const peer = this.peer;
    if (!peer?.mcpCommand || !peer.socketPath) return [];
    return [
      {
        name: "tangent-peer",
        command: peer.mcpCommand.bin,
        args: [...peer.mcpCommand.args, "--socket", peer.socketPath],
        env: [
          {
            name: peer.socketEnvName ?? DEFAULT_PEER_ENV,
            value: peer.socketPath,
          },
        ],
      },
    ];
  }

  /**
   * The orientation appended to the agent's own instructions: always the Prime
   * relationship, the message_prime line when that tool is wired, and the peer
   * section when a launcher channel exists.
   */
  private systemPrompt(): SystemPrompt {
    const sections = [PRIME_SYSTEM_PROMPT];
    if (this.prime && this.hostApi) sections.push(PRIME_TOOL_PROMPT);
    if (this.peer) sections.push(PEER_SYSTEM_PROMPT);
    return {
      mode: "append",
      content: [{ type: "text", text: sections.join("\n\n") }],
    };
  }

  /** Ends the attachment: stops the loop, kills the agent, marks the tab. */
  async dispose(): Promise<void> {
    this.stopped = true;
    this.running = false;
    this.pollAbort?.abort();
    this.session?.dispose();
    await this.peerServer
      ?.close()
      .catch((err: unknown) => this.log(`peer close failed: ${message(err)}`));
    await this.hostApi
      ?.close()
      .catch((err: unknown) =>
        this.log(`host api close failed: ${message(err)}`),
      );
    if (this.agentId) {
      await this.client
        .setStatus(this.agentId, "killed")
        .catch((err: unknown) => this.log(`status failed: ${message(err)}`));
    }
  }

  /**
   * Runs the next piece of work until stopped. A queued launcher message is
   * taken first and run as a peer turn; otherwise the loop waits for either a
   * Prime directive or a launcher message, whichever lands first.
   */
  private async loop(): Promise<void> {
    while (this.running && !this.stopped) {
      const queued = this.mailbox?.tryTake("parent");
      if (queued) {
        await this.runPeerTurn(queued.text);
        continue;
      }
      await this.waitForWork();
    }
  }

  /** Waits on the Prime poll, racing a launcher message when a mailbox exists. */
  private async waitForWork(): Promise<void> {
    this.pollInFlight ??= this.poll();
    const poll = this.pollInFlight;
    if (this.mailbox) {
      const winner = await Promise.race([
        poll.then(() => "poll" as const),
        this.mailbox.signal("parent").then(() => "peer" as const),
      ]);
      if (winner === "peer") return;
    }
    this.pollInFlight = undefined;
    await this.handlePoll(await poll);
  }

  /** Runs a poll's directives, or backs off when the poll came back empty. */
  private async handlePoll(
    deliveries: AttachDelivery[] | undefined,
  ): Promise<void> {
    if (!deliveries) {
      await sleep(RETRY_MS);
      return;
    }
    await this.runDeliveries(deliveries);
  }

  /**
   * One deliveries poll scoped to this agent, or undefined when it failed (the
   * caller backs off). An abort — from {@link dispose} — reads as an empty poll,
   * not an error, so a detaching bridge does not log a spurious failure.
   */
  private async poll(): Promise<AttachDelivery[] | undefined> {
    const agentId = this.agentId;
    if (!agentId) return undefined;
    this.pollAbort = new AbortController();
    try {
      return await this.client.deliveries(agentId, this.pollAbort.signal);
    } catch (err) {
      if (this.pollAbort.signal.aborted) return [];
      this.log(`deliveries failed: ${message(err)}`);
      return undefined;
    } finally {
      this.pollAbort = undefined;
    }
  }

  /** Runs each of this tab's directives in turn, stopping if disposed. */
  private async runDeliveries(deliveries: AttachDelivery[]): Promise<void> {
    for (const delivery of deliveries) {
      if (this.stopped) return;
      if (delivery.agentId !== this.agentId) continue;
      await this.runTurn(primePrompt(delivery.text));
    }
  }

  /**
   * Runs a launcher message as a turn, then — unless the agent already answered
   * with `peer_send` during it — hands the turn's reply back to the launcher.
   */
  private async runPeerTurn(text: string): Promise<void> {
    const mailbox = this.mailbox;
    if (!mailbox) return;
    const before = mailbox.sentCount("agent");
    const reply = await this.runTurn(peerPrompt(text));
    if (mailbox.sentCount("agent") === before && reply.trim()) {
      mailbox.send("agent", reply);
    }
  }

  /** Runs one directive as an ACP prompt turn, settles its Run, returns text. */
  private async runTurn(text: string): Promise<string> {
    const { session, agentId } = this;
    if (!session || !agentId) return "";

    this.runId = await this.client.openRun(agentId);
    this.turn = new TurnStreamer();
    const status = await this.promptTurn(session, text);
    let content = "";
    for (const event of this.turn.end()) {
      if (event.type === "end") content = event.content;
      this.emit(event);
    }
    await this.pushChain;
    const runId = this.runId;
    this.turn = undefined;
    this.runId = undefined;
    await this.client
      .endRun(agentId, status, runId)
      .catch((err: unknown) => this.log(`run end failed: ${message(err)}`));
    return content;
  }

  /** Runs the prompt, mapping its stop reason (or a throw) to a Run status. */
  private async promptTurn(
    session: AcpSession,
    text: string,
  ): Promise<AttachRunStatus> {
    try {
      return runStatus(await session.prompt(text));
    } catch (err) {
      this.emit({ type: "error", message: message(err) });
      return "failed";
    }
  }

  /** Routes the agent's stream into the active turn. */
  private onUpdate(update: SessionNotification["update"]): void {
    if (!this.turn) return;
    for (const event of this.turn.apply(update)) this.emit(event);
  }

  /** Posts one event, serialized so start precedes its deltas precede end. */
  private emit(event: RemoteAgentEvent): void {
    const { agentId, runId } = this;
    if (!agentId) return;
    this.pushChain = this.pushChain
      .then(() => this.client.pushEvent(agentId, event, runId))
      .catch((err: unknown) => this.log(`event push failed: ${message(err)}`));
  }

  /** The agent process ended: stop the loop and complete the tab. */
  private onExit(reason: string): void {
    this.log(`agent ${reason}`);
    this.running = false;
    if (this.agentId && !this.stopped) {
      void this.client
        .setStatus(this.agentId, "completed")
        .catch((err: unknown) => this.log(`status failed: ${message(err)}`));
    }
  }
}

/** The message of an unknown error. */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
