import { createServer } from "node:http";

import express from "express";
import { Server as SocketIOServer } from "socket.io";

import { PORT } from "./config.ts";
import { createSessionsRouter } from "./routes/sessions.ts";
import { registerChatHandlers } from "./sockets/chat.ts";
import { InMemorySessionStore } from "./store/inMemorySessionStore.ts";

// Single shared store instance backs both REST routes and socket handlers.
const store = new InMemorySessionStore();

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/sessions", createSessionsRouter(store));

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  // In dev the UI is served by Vite and proxied here, so same-origin. CORS is
  // left open to ease direct connections during local development.
  cors: { origin: true },
});

registerChatHandlers(io, store);

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
