import {
  ATTACH_TOKEN_HEADER,
  type Resource,
} from "@tangent/shared/contracts.ts";
import type {
  RemoteAgentEvent,
  RemoteResourceInput,
} from "@tangent/shared/remoteSubagent.ts";

/** One message Tangent wants carried to an attached agent. */
export interface AttachDelivery {
  agentId: string;
  text: string;
}

/** How a turn's Run ended, in the gateway's vocabulary. */
export type AttachRunStatus = "completed" | "cancelled" | "failed";

/** An attached agent tab's lifecycle status. */
export type AttachAgentStatus = "active" | "completed" | "killed" | "error";

export interface AttachClientOptions {
  /** The Shell origin + mount path, without a trailing slash. */
  shellUrl: string;
  /** The session-scoped remote-env token minted for this attach. */
  token: string;
  /** The session this client is pinned to (the token's session). */
  sessionId: string;
  /** Test seam; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/**
 * HTTP driver for the `/api/attach` API. Holds the only route to a locally-run
 * ACP agent, so it registers a tab, polls for the work Tangent wants carried to
 * it, opens a Run per turn, streams the agent's output back, and marks the
 * tab's lifecycle. Every call carries the session-scoped token the attach route
 * pins to its session; {@link setToken} swaps it when the CLI refreshes.
 */
export class AttachClient {
  private readonly shellUrl: string;
  private token: string;
  readonly sessionId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AttachClientOptions) {
    this.shellUrl = options.shellUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.sessionId = options.sessionId;
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** Swaps the bearer token, e.g. after a refresh mint. */
  setToken(token: string): void {
    this.token = token;
  }

  /** Registers the tab and resolves the server-assigned agent id. */
  async register(name: string, template?: string): Promise<string> {
    const result = await this.post<{ subagent: { id: string } }>("register", {
      sessionId: this.sessionId,
      name,
      ...(template ? { template } : {}),
    });
    return result.subagent.id;
  }

  /** Long-polls for messages queued for this agent's tab in the session. */
  async deliveries(
    agentId: string,
    signal?: AbortSignal,
  ): Promise<AttachDelivery[]> {
    const result = await this.post<{ deliveries: AttachDelivery[] }>(
      "deliveries",
      { sessionId: this.sessionId, agentId },
      signal,
    );
    return result.deliveries;
  }

  /** Opens a Run for one turn of an agent's work, resolving its id. */
  async openRun(agentId: string): Promise<string> {
    const result = await this.post<{ runId: string }>("run", {
      sessionId: this.sessionId,
      agentId,
    });
    return result.runId;
  }

  /** Settles a turn's Run. */
  async endRun(
    agentId: string,
    status: AttachRunStatus,
    runId?: string,
  ): Promise<void> {
    await this.post("run/end", {
      sessionId: this.sessionId,
      agentId,
      status,
      ...(runId ? { runId } : {}),
    });
  }

  /** Streams one agent event into the tab, attributed to a Run. */
  async pushEvent(
    agentId: string,
    event: RemoteAgentEvent,
    runId?: string,
  ): Promise<void> {
    await this.post("event", {
      sessionId: this.sessionId,
      agentId,
      event,
      ...(runId ? { runId } : {}),
    });
  }

  /**
   * Posts a proactive message to Prime (the session orchestrator) in the tab's
   * own thread, mentioning Prime so it wakes — the same path the attach announce
   * uses. `agentId` attributes the message to the tab.
   */
  async reportToPrime(agentId: string, text: string): Promise<void> {
    await this.post("report", {
      sessionId: this.sessionId,
      agentId,
      text,
    });
  }

  /** Marks the tab's lifecycle status. */
  async setStatus(agentId: string, status: AttachAgentStatus): Promise<void> {
    await this.post("status", {
      sessionId: this.sessionId,
      agentId,
      status,
    });
  }

  /**
   * Contributes a resource (a file/blob, a host entry, or a memory write) to the
   * session so Prime and other agents can see and fetch it. Resolves with the
   * stored {@link Resource}; `agentId` attributes the contribution to the tab.
   */
  async addResource(
    agentId: string,
    input: RemoteResourceInput,
  ): Promise<Resource> {
    const result = await this.post<{ resource: Resource }>("resources/put", {
      sessionId: this.sessionId,
      agentId,
      input,
    });
    return result.resource;
  }

  /** Lists the session's catalogued resources. */
  async listResources(): Promise<Resource[]> {
    const result = await this.post<{ resources: Resource[] }>(
      "resources/list",
      { sessionId: this.sessionId },
    );
    return result.resources;
  }

  /** Fetches a session resource's base64 bytes and content type by its uri. */
  async readResource(
    uri: string,
  ): Promise<{ content: string; contentType: string }> {
    return this.post<{ content: string; contentType: string }>(
      "resources/read",
      { sessionId: this.sessionId, uri },
    );
  }

  private async post<T>(
    route: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.fetchImpl(
      `${this.shellUrl}/api/attach/${route}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.token}`,
          // Fallback carrier for the token: an SSO proxy in front of the Shell
          // may strip or overwrite Authorization, so the server also reads this.
          [ATTACH_TOKEN_HEADER]: this.token,
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `attach ${route} failed (${response.status}) ${detail}`.trim(),
      );
    }
    return (await response.json()) as T;
  }
}
