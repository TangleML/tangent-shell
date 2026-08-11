import "./loadEnv.ts";

import { createServer } from "node:http";

import express from "express";
import { Server as SocketIOServer } from "socket.io";

import { PORT } from "./config.ts";
import { createConnectorRegistry } from "./connectors/connectorRegistry.ts";
import { ExternalSubagentGateway } from "./external/externalSubagentGateway.ts";
import { RelayRegistry } from "./mcp/relayRegistry.ts";
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
import { createInternalEgressRouter } from "./routes/internalEgress.ts";
import { createInternalExternalAgentsRouter } from "./routes/internalExternalAgents.ts";
import { createInternalMcpRelayRouter } from "./routes/internalMcpRelay.ts";
import { createInternalMemoryRouter } from "./routes/internalMemory.ts";
import { createInternalSessionRouter } from "./routes/internalSession.ts";
import { createInternalTriggersRouter } from "./routes/internalTriggers.ts";
import { createMcpRelayRouter } from "./routes/mcp.ts";
import { createMeRouter } from "./routes/me.ts";
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

// Relays a message into a session's Prime process. Shared by the remote-env
// gateway and the generic MCP relay so both feed Prime the same way.
const deliverToPrime = (sessionId: string, text: string): void =>
  pi.sendToAgent(sessionId, PRIME_AGENT_ID, text);

// Hosts sub-agents inside a connected remote environment over the `/remote-env`
// namespace. Remote sub-agents share the same relay handlers as local ones, and
// their finalized replies/reports are fed into the session's Prime process.
const remoteGateway = new RemoteEnvironmentGateway(
  io,
  agentHandlers,
  store,
  deliverToPrime,
);

// Registry of external sub-agent tabs: work runs outside Tangent (e.g. driven
// by a bundle tool over the internal external-agents API) and streams into a
// tab via the same relay handlers a local sub-agent uses.
const externalGateway = new ExternalSubagentGateway(agentHandlers);

// The single lookup from a participant to the connector that reaches it. Every
// spawn/message/kill/list route goes through it, so an id no connector holds is
// refused in its own conversation instead of falling through to the local Pi.
const connectors = createConnectorRegistry(
  pi,
  remoteGateway,
  externalGateway,
  agentHandlers,
);

// Generic MCP relay: bridges an external MCP client (dialed by a gateway) to a
// session's Prime. Bundles open channels over the internal API; the peer's tool
// calls arrive on the public /api/mcp route and are relayed to Prime.
const mcpRelay = new RelayRegistry();

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
// Public MCP relay dialed by an external client; per-channel bearer in the URL.
app.use("/api/mcp", createMcpRelayRouter(mcpRelay, deliverToPrime));
// Returns the current user, derived from the Oktasso JWT cookie.
app.use("/api/me", createMeRouter());
// Internal API for the orchestrator extension running inside each Pi process.
app.use("/internal/agents", createInternalAgentsRouter(store, pi, connectors));
// Internal API a bundle tool uses to drive external sub-agent tabs: register a
// tab, stream the external runtime's output into it, and mark its lifecycle.
app.use(
  "/internal/external-agents",
  createInternalExternalAgentsRouter(externalGateway),
);
// Internal egress proxy for bundle tool extensions (e.g. the Tangle API tool).
app.use("/internal/egress", createInternalEgressRouter());
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
// Internal API for bundle extensions to open/answer/close generic MCP relay
// channels bound to their session (remote-runtime specifics stay in the bundle).
app.use("/internal/mcp-relay", createInternalMcpRelayRouter(mcpRelay, store));

// Mounted last: async failures from any handler above land here with a
// consistent `{ error }` shape (Express 5 forwards rejected promises to it).
app.use(errorHandler);

registerChatHandlers(
  io,
  store,
  pi,
  connectors,
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
