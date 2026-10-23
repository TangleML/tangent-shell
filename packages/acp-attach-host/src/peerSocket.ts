import { chmod, mkdir, rm } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";

import {
  type PeerMailbox,
  type PeerMessage,
  type PeerOrigin,
} from "./peerMailbox.ts";

/** How long a `wait` parks before answering empty, if the caller gives none. */
const DEFAULT_WAIT_MS = 300_000;

/** One line of newline-delimited JSON, from a peer client to the mailbox. */
interface PeerRequest {
  op: "send" | "wait";
  /** For `send`, who the message is from; for `wait`, whose messages to take. */
  origin: PeerOrigin;
  text?: string;
  timeoutMs?: number;
}

/** The single reply a peer client reads back before the socket closes. */
interface PeerReply {
  ok?: boolean;
  message?: PeerMessage;
  timeout?: boolean;
  error?: string;
}

/** A listening mailbox socket, closed (and unlinked) on {@link close}. */
export interface PeerServer {
  close(): Promise<void>;
}

/**
 * Listens on `socketPath` and routes each connection's one request into
 * `mailbox`. Refuses to start when a live server already holds the path, so a
 * second attach for the same session fails fast rather than forking the queue.
 */
export async function createPeerServer(
  socketPath: string,
  mailbox: PeerMailbox,
): Promise<PeerServer> {
  await mkdir(dirname(socketPath), { recursive: true });
  if (await isPeerSocketAlive(socketPath)) {
    throw new Error(`a peer mailbox is already listening at ${socketPath}`);
  }
  await rm(socketPath, { force: true });
  const server = createServer((socket) => handleConnection(socket, mailbox));
  await listen(server, socketPath);
  await chmod(socketPath, 0o600);
  return { close: () => closeServer(server, socketPath) };
}

/** Sends one message to the mailbox; false when nothing is listening. */
export async function peerSend(
  socketPath: string,
  origin: PeerOrigin,
  text: string,
): Promise<boolean> {
  if (!socketPath) return false;
  const reply = await request(socketPath, { op: "send", origin, text }).catch(
    (): PeerReply => ({}),
  );
  return reply.ok === true;
}

/** Waits for one message, or undefined on timeout (or nothing listening). */
export async function peerWait(
  socketPath: string,
  origin: PeerOrigin,
  timeoutMs?: number,
): Promise<PeerMessage | undefined> {
  if (!socketPath) return undefined;
  const reply = await request(socketPath, {
    op: "wait",
    origin,
    timeoutMs,
  }).catch((): PeerReply => ({}));
  return reply.message;
}

/** Whether a server currently answers at `socketPath`. */
export function isPeerSocketAlive(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

function handleConnection(socket: Socket, mailbox: PeerMailbox): void {
  socket.setEncoding("utf8");
  const abort = new AbortController();
  socket.on("close", () => abort.abort());
  socket.on("error", () => abort.abort());
  let buffer = "";
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    socket.removeAllListeners("data");
    void answer(socket, mailbox, buffer.slice(0, newline), abort.signal);
  });
}

async function answer(
  socket: Socket,
  mailbox: PeerMailbox,
  line: string,
  signal: AbortSignal,
): Promise<void> {
  const reply = await compute(mailbox, line, signal).catch(
    (err: unknown): PeerReply => ({ error: message(err) }),
  );
  if (!socket.writableEnded) socket.end(`${JSON.stringify(reply)}\n`);
}

async function compute(
  mailbox: PeerMailbox,
  line: string,
  signal: AbortSignal,
): Promise<PeerReply> {
  const req = JSON.parse(line) as PeerRequest;
  if (req.op === "send") {
    if (!req.text) return { error: "send requires text" };
    mailbox.send(req.origin, req.text);
    return { ok: true };
  }
  if (req.op === "wait") {
    const found = await mailbox.take(
      req.origin,
      req.timeoutMs ?? DEFAULT_WAIT_MS,
      signal,
    );
    return found ? { message: found } : { timeout: true };
  }
  return { error: `unknown op ${String(req.op)}` };
}

function request(socketPath: string, req: PeerRequest): Promise<PeerReply> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    socket.setEncoding("utf8");
    let buffer = "";
    let settled = false;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    socket.on("connect", () => socket.write(`${JSON.stringify(req)}\n`));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      done(() => resolve(JSON.parse(line) as PeerReply));
      socket.end();
    });
    socket.on("error", (err) => done(() => reject(err)));
    socket.on("close", () =>
      done(() => reject(new Error("peer socket closed before a reply"))),
    );
  });
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(socketPath, { force: true });
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
