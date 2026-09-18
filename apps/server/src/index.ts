import "./loadEnv.ts";

import { createServer } from "node:http";

import express from "express";
import { Server as SocketIOServer } from "socket.io";

import { A2aPeerGateway } from "./a2a/a2aPeerGateway.ts";
import { PORT } from "./config.ts";
import { createConnectorRegistry } from "./connectors/connectorRegistry.ts";
import { ConversationRouter } from "./conversation/conversationRouter.ts";
import { MembershipRegistry } from "./conversation/membershipRegistry.ts";
import { ParticipantRegistry } from "./conversation/participantRegistry.ts";
import { ParticipantService } from "./conversation/participantService.ts";
import { ResourceCatalog } from "./conversation/resourceCatalog.ts";
import { ExternalSubagentGateway } from "./external/externalSubagentGateway.ts";
import { RelayRegistry } from "./mcp/relayRegistry.ts";
import { createRelayReport } from "./mcp/relayReport.ts";
import { errorHandler } from "./middleware/errorHandler.ts";
import { MemoryManager } from "./pi/memory.ts";
import {
  type ConversationEventSink,
  PiAgentManager,
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
import { RunRegistry } from "./runs/runRegistry.ts";
import {
  createAgentEventHandler,
  createAgentMessageHandler,
  createSessionStatusHandler,
  createSubagentUpdateHandler,
} from "./sockets/agentEvents.ts";
import { registerChatHandlers } from "./sockets/chat.ts";
import {
  createMemoryRememberedHandler,
  createMemorySuggestionHandler,
} from "./sockets/chatMemory.ts";
import {
  createParticipantPresenceEmitter,
  PresenceTracker,
} from "./sockets/presenceTracker.ts";
import { createUiCommandEmitter } from "./sockets/sessionRoster.ts";
import { openDb } from "./store/db/client.ts";
import { FileAgentBundleStore } from "./store/fileAgentBundleStore.ts";
import { SqliteMembershipStore } from "./store/sqliteMembershipStore.ts";
import { SqliteParticipantStore } from "./store/sqliteParticipantStore.ts";
import { SqliteResourceStore } from "./store/sqliteResourceStore.ts";
import { SqliteRunStore } from "./store/sqliteRunStore.ts";
import { SqliteSessionStore } from "./store/sqliteSessionStore.ts";

// Opening the DB applies pending drizzle-kit migrations on startup. The single
// shared connection backs every store: session metadata for the REST routes and
// socket handlers, runs for the run registry, participants for the roster
// projection.
const db = openDb();
// The participant projection each roster write mirrors into. `session_agents`
// stays the write authority for this PR; this keeps the `participants` table
// tracking it so Phase 2 consumers read a populated table.
const participants = new SqliteParticipantStore(db);
// The resource catalog every content path mirrors into: a pinned artifact, a
// message attachment, a memory write. Additive for now — the existing stores
// stay authoritative and this table tracks them so a resource is citable.
const resourceStore = new SqliteResourceStore(db);
const store = new SqliteSessionStore(db, participants, resourceStore);
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

// Surfaces pending memory suggestions to the session room.
const onMemorySuggestion = createMemorySuggestionHandler(io);

// Pushes generic agent->UI directives (e.g. session rename) to the room.
const emitUiCommand = createUiCommandEmitter(io);

// Who is in each Conversation and what each of them reacts to. Rows are derived
// from the agent roster on a cache miss, so a session the backfill never touched
// still resolves; `acceptsDelivery` is read lazily because the registry it comes
// from is built below.
const membershipStore = new SqliteMembershipStore(db);
const memberships = new MembershipRegistry(store, membershipStore, (kind) =>
  connectors.acceptsDelivery(kind),
);

// The read surface over the `participants` table, reconciling stored humans and
// automations with the agent roster. 2.1 left it unit-tested only; this PR is
// its first runtime consumer.
const participantRegistry = new ParticipantRegistry(store, participants);

// The one way a Message enters a Conversation: persist, broadcast, then deliver
// to whoever reacts. Every entry point — a human turn, a trigger firing, a tool
// call, a finalized agent turn — goes through it. It also mirrors the content a
// Message carries (attachments, memory writes) into the resource catalog.
const resourceCatalog = new ResourceCatalog(resourceStore);
const conversations = new ConversationRouter(
  io,
  store,
  memberships,
  resourceCatalog,
);

// Shared event sink: a participant's streaming events, roster changes and posted
// messages land the same way whether it runs locally (PiAgentManager), in a
// remote environment, or entirely outside Tangent.
const agentHandlers: ConversationEventSink = {
  onAgentEvent: createAgentEventHandler(io, store, conversations),
  onSubagentUpdate: createSubagentUpdateHandler(io, store),
  onAgentMessage: createAgentMessageHandler(conversations),
  onSessionStatus: createSessionStatusHandler(io),
};

// Tracks which participant is working under which run id, so every stream is
// attributable and cancellation has a run to act on. Rows left `running` by a
// previous process are settled once here: nothing can run before we start.
const runs = new RunRegistry(new SqliteRunStore(db));
void runs.failStaleRuns().then((failed) => {
  if (failed > 0) console.log(`[runs] settled ${failed} stale run(s)`);
});

// No participant outlives the server, so every sub-agent row still claiming to
// be live is stale. Marking them `detached` here is what keeps the sessions list
// from counting agents that no longer exist; a revive moves them back.
void store.detachActiveSubagents().then((detached) => {
  if (detached > 0) console.log(`[agents] detached ${detached} stale row(s)`);
});

// The manager runs a roster of Pi processes per session (Prime + sub-agents);
// their streaming events and roster changes are relayed to the matching
// Socket.IO room by the chat handlers.
const pi = new PiAgentManager(agentHandlers, memory, runs);

// Hosts sub-agents inside a connected remote environment over the `/remote-env`
// namespace. Remote sub-agents share the same event sink as local ones, so what
// they produce is persisted in their own Conversation and fanned out from there.
const remoteGateway = new RemoteEnvironmentGateway(
  io,
  agentHandlers,
  store,
  runs,
);

// Generic MCP relay: bridges an external MCP client (dialed by a gateway) back
// into a session. A connector opens a channel for the participant it registers;
// the peer's tool calls arrive on the public /api/mcp route.
const mcpRelay = new RelayRegistry();

// Registry of external sub-agent tabs: work runs outside Tangent (e.g. driven
// by a bundle tool over the internal external-agents API) and streams into a
// tab via the same relay handlers a local sub-agent uses. It holds both legs —
// the inbound stream and the outbound queue its driver drains — plus the
// callback channel each tab's far side dials back on.
const externalGateway = new ExternalSubagentGateway(
  agentHandlers,
  runs,
  store,
  mcpRelay,
);

// Registry of attached A2A agents: heterogeneous agents that already run as a
// service elsewhere, which Tangent dials over the A2A protocol. Their Tasks
// become Runs and their artifacts land in the session workspace.
const a2aGateway = new A2aPeerGateway(
  agentHandlers,
  runs,
  store,
  emitUiCommand,
);

// The single lookup from a participant to the connector that reaches it. Every
// spawn/message/kill/list route goes through it, so an id no connector holds is
// refused in its own conversation instead of falling through to the local Pi.
const connectors = createConnectorRegistry(
  pi,
  remoteGateway,
  externalGateway,
  a2aGateway,
  agentHandlers,
);

// Closes the loop: the router needs connectors to deliver a reaction, and the
// connectors needed the sink that needs the router. The cycle is in the wiring,
// not in the dependency, so it is broken here rather than by an indirection.
conversations.useConnectors(connectors);

// Broadcasts a participant's live presence to its session room.
const emitParticipantPresence = createParticipantPresenceEmitter(io);

// The lifecycle of humans, automations and their memberships: invitation,
// presence, revocation, and the membership edits (join, leave, mute, close) a
// multi-actor Conversation needs. Owns the rows the agent roster never writes.
const participantService = new ParticipantService(
  participants,
  membershipStore,
  participantRegistry,
  memberships,
  runs,
  connectors,
  emitParticipantPresence,
);

// Refcounts each participant's live sockets so presence follows the person.
const presence = new PresenceTracker();

// Surfaces applied memory writes as a highlighted message in Prime's thread,
// authored by the memory Automation Participant this ensures exists.
const onMemoryRemembered = createMemoryRememberedHandler(
  conversations,
  store,
  participantService,
);

// Where a relay peer's words land: posted as the participant its channel belongs
// to, or delivered to Prime when no participant owns the channel.
const relayReport = createRelayReport(connectors, conversations, store);

// Drives schedule timers and callback firings, posting prompts into the target's
// Conversation.
const triggerEngine = new TriggerEngine(
  io,
  store,
  pi,
  triggers,
  conversations,
  participantService,
);

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
  createSessionsRouter(
    store,
    pi,
    triggers,
    triggerEngine,
    agentBundleStore,
    participantService,
    resourceCatalog,
  ),
);
app.use("/api/agent-bundles", createAgentBundlesRouter(agentBundleStore));
app.use("/api/global-memory", createGlobalMemoryRouter(memory));
// Public MCP relay dialed by an external client; per-channel bearer in the URL.
app.use("/api/mcp", createMcpRelayRouter(mcpRelay, relayReport));
// Returns the current user, derived from the Oktasso JWT cookie.
app.use("/api/me", createMeRouter());
// Internal API for the orchestrator extension running inside each Pi process.
app.use(
  "/internal/agents",
  createInternalAgentsRouter(
    store,
    connectors,
    conversations,
    a2aGateway,
    participantService,
  ),
);
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

registerChatHandlers({
  io,
  store,
  pi,
  connectors,
  conversations,
  memory,
  onRemembered: onMemoryRemembered,
  triggerEngine,
  emitUiCommand,
  participantService,
  presence,
});

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

function shutdown(): void {
  pi.disposeAll();
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
