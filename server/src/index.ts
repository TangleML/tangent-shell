import { createServer } from "node:http";

import express from "express";
import { Server as SocketIOServer } from "socket.io";

import { PORT } from "./config.ts";
import { PiAgentManager } from "./pi/piAgentManager.ts";
import { createSessionsRouter } from "./routes/sessions.ts";
import { createAgentEventHandler, registerChatHandlers } from "./sockets/chat.ts";
import { InMemorySessionStore } from "./store/inMemorySessionStore.ts";

// Single shared store instance backs both REST routes and socket handlers.
const store = new InMemorySessionStore();

const app = express();
app.use(express.json());

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  // In dev the UI is served by Vite and proxied here, so same-origin. CORS is
  // left open to ease direct connections during local development.
  cors: { origin: true },
});

// The manager spawns one Pi process per session; its events are relayed to the
// matching Socket.IO room by the chat handler.
const pi = new PiAgentManager(createAgentEventHandler(io, store));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/sessions", createSessionsRouter(store, pi));

registerChatHandlers(io, store, pi);

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

function shutdown(): void {
  pi.disposeAll();
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
