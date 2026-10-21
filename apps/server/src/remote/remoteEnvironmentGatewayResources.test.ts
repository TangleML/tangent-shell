import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  RemoteEnvEvents,
  type RemoteResourceAddResponse,
  type RemoteResourceListResponse,
  type RemoteResourceReadResponse,
} from "@tangent/shared/remoteSubagent.ts";
import type { Server as SocketIOServer, Socket } from "socket.io";

// Point the session root at a throwaway dir before importing modules that read
// config at load time, so a `file` resource write never touches the repo.
const ROOT = mkdtempSync(path.join(tmpdir(), "remote-env-resources-"));
process.env.SESSIONS_ROOT = ROOT;

const { ScopedTokenCredential, HandshakeTokenCredential } =
  await import("../connectors/credentials.ts");
const { ResourceCatalog } = await import("../conversation/resourceCatalog.ts");
const { HostResourcePreamble } = await import("../pi/hostResourcePreamble.ts");
const { MemoryManager } = await import("../pi/memory.ts");
const { RunRegistry } = await import("../runs/runRegistry.ts");
const { InMemoryRunStore } = await import("../store/inMemoryRunStore.ts");
const { InMemoryResourceStore } =
  await import("../store/inMemoryResourceStore.ts");
const { InMemorySessionStore } =
  await import("../store/inMemorySessionStore.ts");
const { InMemoryParticipantStore } =
  await import("../store/inMemoryParticipantStore.ts");
const { RemoteEnvironmentGateway } =
  await import("./remoteEnvironmentGateway.ts");

after(() => rmSync(ROOT, { recursive: true, force: true }));

const ENV_TOKEN = "test-env-token";
const SCOPED_SECRET = "test-signing-secret";

interface SentEntry {
  event: string;
  payload: unknown;
  ack?: (err: Error | null, response: unknown) => void;
}

function fakeSocket(auth: Record<string, unknown>) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const sent: SentEntry[] = [];
  const emit = (event: string, payload: unknown, ack?: unknown) =>
    sent.push({ event, payload, ack: ack as SentEntry["ack"] });
  const socket = {
    id: `socket-${String(auth.environmentId)}`,
    handshake: { auth },
    data: {} as Record<string, unknown>,
    connected: true,
    on: (event: string, handler: (...args: unknown[]) => void) =>
      listeners.set(event, handler),
    emit,
    timeout: () => ({ emit }),
    disconnect: () => listeners.get("disconnect")?.(undefined),
  } as unknown as Socket;
  return { socket, listeners, sent };
}

function fakeNamespace() {
  let onConnection: ((socket: Socket) => void) | undefined;
  let authenticate:
    | ((socket: Socket, next: (err?: Error) => void) => void)
    | undefined;
  return {
    namespace: {
      use: (fn: (socket: Socket, next: (err?: Error) => void) => void) => {
        authenticate = fn;
      },
      on: (event: string, handler: (socket: Socket) => void) => {
        if (event === "connection") onConnection = handler;
      },
    },
    connect(environmentId: string, token: string) {
      const { socket, listeners } = fakeSocket({ environmentId, token });
      let refused: Error | undefined;
      authenticate?.(socket, (err) => {
        refused = err;
      });
      if (!refused) onConnection?.(socket);
      return {
        refused,
        send: (event: string, ...args: unknown[]) =>
          listeners.get(event)?.(...args),
      };
    },
  };
}

function makeHarness() {
  const { namespace, connect } = fakeNamespace();
  const store = new InMemorySessionStore(new InMemoryParticipantStore());
  const runs = new RunRegistry(new InMemoryRunStore());
  const catalog = new ResourceCatalog(new InMemoryResourceStore());
  const memory = new MemoryManager();
  const io = { of: () => namespace, emit: () => {} };
  const scoped = new ScopedTokenCredential(SCOPED_SECRET);
  const gateway = new RemoteEnvironmentGateway(
    io as unknown as SocketIOServer,
    {
      onAgentEvent: () => {},
      onSubagentUpdate: () => {},
      onAgentMessage: () => {},
      onSessionStatus: () => {},
    },
    store,
    runs,
    new HandshakeTokenCredential(ENV_TOKEN),
    scoped,
  );
  gateway.useResources({
    seed: { store, memory, catalog },
    catalog,
    hostPreamble: new HostResourcePreamble(catalog),
    emitResourcesUpdated: () => {},
  });
  return { gateway, connect, store, catalog, scoped };
}

/** Drives one ack event and resolves with the environment's response. */
function ack<T>(
  env: { send: (event: string, ...args: unknown[]) => void },
  event: string,
  request: unknown,
): Promise<T> {
  return new Promise<T>((resolve) => {
    env.send(event, request, (response: T) => resolve(response));
  });
}

test("an unscoped host adds a file resource and reads its bytes back", async () => {
  const h = makeHarness();
  const session = await h.store.createSession({ name: "S" });
  const env = h.connect("env-1", ENV_TOKEN);

  const add = await ack<RemoteResourceAddResponse>(
    env,
    RemoteEnvEvents.ResourceAdd,
    {
      sessionId: session.id,
      agentId: "agent-1",
      input: { kind: "file", path: "report.csv", content: "a,b\n1,2\n" },
    },
  );
  assert.equal(add.ok, true);
  assert.equal(add.resource?.uri, "uploads/report.csv");

  const onDisk = readFileSync(
    path.join(ROOT, session.id, "uploads", "report.csv"),
    "utf8",
  );
  assert.equal(onDisk, "a,b\n1,2\n");

  const read = await ack<RemoteResourceReadResponse>(
    env,
    RemoteEnvEvents.ResourceRead,
    { sessionId: session.id, uri: "uploads/report.csv" },
  );
  assert.equal(read.ok, true);
  assert.equal(
    Buffer.from(read.content ?? "", "base64").toString("utf8"),
    "a,b\n1,2\n",
  );
  assert.equal(read.contentType, "text/csv");

  const list = await ack<RemoteResourceListResponse>(
    env,
    RemoteEnvEvents.ResourceList,
    { sessionId: session.id },
  );
  assert.ok(list.resources.some((r) => r.uri === "uploads/report.csv"));
});

test("a read is refused for a uri that escapes the session root", async () => {
  const h = makeHarness();
  const session = await h.store.createSession({ name: "S" });
  const env = h.connect("env-1", ENV_TOKEN);

  const read = await ack<RemoteResourceReadResponse>(
    env,
    RemoteEnvEvents.ResourceRead,
    { sessionId: session.id, uri: "../../etc/passwd" },
  );
  assert.equal(read.ok, false);
  assert.match(read.error ?? "", /outside the session/);
});

test("a session-scoped host cannot add to another session", async () => {
  const h = makeHarness();
  const mine = await h.store.createSession({ name: "mine" });
  const other = await h.store.createSession({ name: "other" });
  const token = h.scoped.mint({
    environmentId: "env-1",
    sessionId: mine.id,
    sub: "user@example.com",
  }).token;
  const env = h.connect("env-1", token);

  const add = await ack<RemoteResourceAddResponse>(
    env,
    RemoteEnvEvents.ResourceAdd,
    {
      sessionId: other.id,
      agentId: "agent-1",
      input: { kind: "file", path: "x.txt", content: "nope" },
    },
  );
  assert.equal(add.ok, false);
  assert.match(add.error ?? "", /Not authorized/);
});

test("an add acks an error when the catalog is not wired", async () => {
  const { namespace, connect } = fakeNamespace();
  const store = new InMemorySessionStore(new InMemoryParticipantStore());
  const runs = new RunRegistry(new InMemoryRunStore());
  const io = { of: () => namespace, emit: () => {} };
  const gateway = new RemoteEnvironmentGateway(
    io as unknown as SocketIOServer,
    {
      onAgentEvent: () => {},
      onSubagentUpdate: () => {},
      onAgentMessage: () => {},
      onSessionStatus: () => {},
    },
    store,
    runs,
    new HandshakeTokenCredential(ENV_TOKEN),
    new ScopedTokenCredential(SCOPED_SECRET),
  );
  void gateway;
  const session = await store.createSession({ name: "S" });
  const env = connect("env-1", ENV_TOKEN);

  const add = await ack<RemoteResourceAddResponse>(
    env,
    RemoteEnvEvents.ResourceAdd,
    {
      sessionId: session.id,
      agentId: "agent-1",
      input: { kind: "file", path: "x.txt", content: "hi" },
    },
  );
  assert.equal(add.ok, false);
});
