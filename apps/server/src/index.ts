import "./loadEnv.ts";

import { createServer } from "node:http";

import express from "express";
import { Server as SocketIOServer } from "socket.io";

import { PORT } from "./config.ts";
import { errorHandler } from "./middleware/errorHandler.ts";
import { MemoryManager } from "./pi/memory.ts";
import {
  type PiAgentHandlers,
  PiAgentManager,
  PRIME_AGENT_ID,
} from "./pi/piAgentManager.ts";
import { TriggerEngine } from "./pi/triggers/triggerEngine.ts";
import { TriggerManager } from "./pi/triggers/triggerManager.ts";
import { RemoteEnvironmentGateway } from "./remote/remoteEnvironmentGateway.ts";
import { createAgentBundlesRouter } from "./routes/agentBundles.ts";
import { createGlobalMemoryRouter } from "./routes/globalMemory.ts";
import { createInternalAgentsRouter } from "./routes/internalAgents.ts";
import { createInternalCsomRouter } from "./routes/internalCsom.ts";
import { createInternalEgressRouter } from "./routes/internalEgress.ts";
import { createInternalMemoryRouter } from "./routes/internalMemory.ts";
import { createInternalSessionRouter } from "./routes/internalSession.ts";
import { createInternalTriggersRouter } from "./routes/internalTriggers.ts";
import { createMeRouter } from "./routes/me.ts";
import { createRemoteEnvRouter } from "./routes/remoteEnv.ts";
import { createSessionsRouter } from "./routes/sessions/index.ts";
import {
  createAgentEventHandler,
  createAgentMessageHandler,
  createMemoryRememberedHandler,
  createMemorySuggestionHandler,
  createSessionStatusHandler,
  createSubagentUpdateHandler,
  createUiCommandEmitter,
  registerChatHandlers,
} from "./sockets/chat.ts";
import { openDb } from "./store/db/client.ts";
import { FileAgentBundleStore } from "./store/fileAgentBundleStore.ts";
import { SqliteSessionStore } from "./store/sqliteSessionStore.ts";

// Single shared store instance backs both REST routes and socket handlers.
// Opening the DB applies pending drizzle-kit migrations on startup.
const store = new SqliteSessionStore(openDb());
// Filesystem-backed marketplace of saved agent bundles.
const agentBundleStore = new FileAgentBundleStore();

const app = express();
app.use(express.json());

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  // In dev the UI is served by Vite and proxied here, so same-origin. CORS is
  // left open to ease direct connections during local development.
  cors: { origin: true },
});

// Owns the agents' global + per-session memory stores.
const memory = new MemoryManager();

// Owns each session's triggers (schedule + callback) and their persistence.
const triggers = new TriggerManager();

// Surfaces applied memory writes / pending suggestions to the session room.
const onMemoryRemembered = createMemoryRememberedHandler(io, store);
const onMemorySuggestion = createMemorySuggestionHandler(io);

// Pushes generic agent->UI directives (e.g. session rename) to the room.
const emitUiCommand = createUiCommandEmitter(io);

// Shared relay handlers: a sub-agent's streaming events and roster changes are
// fanned to the matching Socket.IO room and persisted the same way, whether the
// sub-agent runs locally (PiAgentManager) or in a remote environment.
const agentHandlers: PiAgentHandlers = {
  onAgentEvent: createAgentEventHandler(io, store),
  onSubagentUpdate: createSubagentUpdateHandler(io, store),
  onAgentMessage: createAgentMessageHandler(io, store),
  onSessionStatus: createSessionStatusHandler(io),
};

// The manager runs a roster of Pi processes per session (Prime + sub-agents);
// their streaming events and roster changes are relayed to the matching
// Socket.IO room by the chat handlers.
const pi = new PiAgentManager(agentHandlers, memory);

// Hosts sub-agents inside a connected remote environment over the `/remote-env`
// namespace. Remote sub-agents share the same relay handlers as local ones, and
// their finalized replies/reports are fed into the session's Prime process.
const remoteGateway = new RemoteEnvironmentGateway(
  io,
  agentHandlers,
  store,
  (sessionId, text) => pi.sendToAgent(sessionId, PRIME_AGENT_ID, text),
);

// Drives schedule timers and callback firings, delivering prompts to Prime.
const triggerEngine = new TriggerEngine(io, store, pi, triggers);

app.get("/api/health", (req, res) => {
  const cookies = Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const idx = pair.indexOf("=");
        return idx === -1
          ? [pair, ""]
          : [pair.slice(0, idx), pair.slice(idx + 1)];
      }),
  );
  res.json({ ok: true, headers: req.headers, cookies });
});

app.use(
  "/api/sessions",
  createSessionsRouter(store, pi, triggers, triggerEngine, agentBundleStore),
);
app.use("/api/agent-bundles", createAgentBundlesRouter(agentBundleStore));
app.use("/api/global-memory", createGlobalMemoryRouter(memory));
// Returns the current user, derived from the Oktasso JWT cookie.
app.use("/api/me", createMeRouter());
// Hands the SPA the `/remote-env` token so the Pipeline Editor tab can connect
// as its session's CSOM executor (only when remote hosting is enabled).
app.use("/api/remote-env", createRemoteEnvRouter());
// Internal API for the orchestrator extension running inside each Pi process.
app.use(
  "/internal/agents",
  createInternalAgentsRouter(store, pi, remoteGateway),
);
// Internal egress proxy for bundle tool extensions (e.g. the Tangle API tool).
app.use("/internal/egress", createInternalEgressRouter());
// Internal CSOM relay: Prime's pipeline-editor tools drive the browser's
// embedded Tangle editor through the remote-environment gateway.
app.use("/internal/csom", createInternalCsomRouter(remoteGateway));
// Internal API for the triggers extension running inside each Pi process.
app.use(
  "/internal/triggers",
  createInternalTriggersRouter(store, triggers, triggerEngine),
);
// Internal API for the memory extension running inside each Pi process.
app.use(
  "/internal/memory",
  createInternalMemoryRouter(
    store,
    memory,
    onMemoryRemembered,
    onMemorySuggestion,
  ),
);
// Internal API for the session extension running inside each Pi process.
app.use("/internal/session", createInternalSessionRouter(store, emitUiCommand));

// Mounted last: async failures from any handler above land here with a
// consistent `{ error }` shape (Express 5 forwards rejected promises to it).
app.use(errorHandler);

registerChatHandlers(
  io,
  store,
  pi,
  remoteGateway,
  memory,
  onMemoryRemembered,
  triggerEngine,
  emitUiCommand,
);

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

function shutdown(): void {
  pi.disposeAll();
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
