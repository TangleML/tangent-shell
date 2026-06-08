import { createServer } from "node:http";

import express from "express";
import { Server as SocketIOServer } from "socket.io";

import { PORT } from "./config.ts";
import { MemoryManager } from "./pi/memory.ts";
import { PiAgentManager } from "./pi/piAgentManager.ts";
import { createAgentBundlesRouter } from "./routes/agentBundles.ts";
import { createInternalAgentsRouter } from "./routes/internalAgents.ts";
import { createInternalMemoryRouter } from "./routes/internalMemory.ts";
import { createSessionsRouter } from "./routes/sessions.ts";
import {
  createAgentEventHandler,
  createAgentMessageHandler,
  createMemoryRememberedHandler,
  createMemorySuggestionHandler,
  createSubagentUpdateHandler,
  registerChatHandlers,
} from "./sockets/chat.ts";
import { FileAgentBundleStore } from "./store/fileAgentBundleStore.ts";
import { InMemorySessionStore } from "./store/inMemorySessionStore.ts";

// Single shared store instance backs both REST routes and socket handlers.
const store = new InMemorySessionStore();
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

// Surfaces applied memory writes / pending suggestions to the session room.
const onMemoryRemembered = createMemoryRememberedHandler(io, store);
const onMemorySuggestion = createMemorySuggestionHandler(io);

// The manager runs a roster of Pi processes per session (Prime + sub-agents);
// their streaming events and roster changes are relayed to the matching
// Socket.IO room by the chat handlers.
const pi = new PiAgentManager(
  {
    onAgentEvent: createAgentEventHandler(io, store),
    onSubagentUpdate: createSubagentUpdateHandler(io),
    onAgentMessage: createAgentMessageHandler(io, store),
  },
  memory,
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/sessions", createSessionsRouter(store, pi, agentBundleStore));
app.use("/api/agent-bundles", createAgentBundlesRouter(agentBundleStore));
// Internal API for the orchestrator extension running inside each Pi process.
app.use("/internal/agents", createInternalAgentsRouter(store, pi));
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

registerChatHandlers(io, store, pi, memory, onMemoryRemembered);

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

function shutdown(): void {
  pi.disposeAll();
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
