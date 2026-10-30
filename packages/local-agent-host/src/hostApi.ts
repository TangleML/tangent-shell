import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

/**
 * One loopback route: receives the parsed JSON body a pi extension posted and
 * returns the JSON body to send back. A throw becomes a `{ ok: false, error }`
 * response, so a route never has to format its own failure.
 */
export type HostApiRoute = (body: unknown) => Promise<unknown>;

/** The loopback routes an attached agent's MCP servers call back into. */
export interface HostApiRoutes {
  put: HostApiRoute;
  list: HostApiRoute;
  read: HostApiRoute;
  /** Posts a proactive message to Prime; absent where no such channel exists. */
  report?: HostApiRoute;
}

/** A running loopback API: its base url, bearer token, and a stop handle. */
export interface HostApi {
  url: string;
  token: string;
  close(): Promise<void>;
}

/** Caps a posted body so a runaway extension cannot exhaust host memory. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Reads a request's JSON body, rejecting an oversized or malformed payload. */
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

/** Sends a JSON response with the given status. */
function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Whether the request carries the expected `Bearer <token>` authorization. */
function authorized(req: IncomingMessage, token: string): boolean {
  return req.headers.authorization === `Bearer ${token}`;
}

/** The route a request targets (`POST /put|/list|/read|/report`), or undefined. */
function routeFor(
  routes: HostApiRoutes,
  req: IncomingMessage,
): HostApiRoute | undefined {
  if (req.method !== "POST") return undefined;
  if (req.url === "/put") return routes.put;
  if (req.url === "/list") return routes.list;
  if (req.url === "/read") return routes.read;
  if (req.url === "/report") return routes.report;
  return undefined;
}

/** Routes one request: authorize, parse, run, and ack — all errors as 4xx JSON. */
async function dispatch(
  routes: HostApiRoutes,
  token: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const route = routeFor(routes, req);
  if (!route) return send(res, 404, { ok: false, error: "Not found" });
  if (!authorized(req, token)) {
    return send(res, 401, { ok: false, error: "Unauthorized" });
  }
  try {
    const result = await route(await readBody(req));
    send(res, 200, { ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send(res, 400, { ok: false, error: message });
  }
}

/**
 * Starts a loopback HTTP API on `127.0.0.1` the host's session-resource pi
 * extension calls back into. Bound to an ephemeral port and guarded by a random
 * per-process bearer token, so only this host's own sub-agents can reach it.
 * Resolves once listening, with the base url and token to inject into pi's env.
 */
export function startHostApi(routes: HostApiRoutes): Promise<HostApi> {
  const token = randomBytes(24).toString("hex");
  const server: Server = createServer((req, res) => {
    void dispatch(routes, token, req, res);
  });
  return new Promise<HostApi>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        token,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
