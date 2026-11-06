import {
  type AgentAbortPayload,
  type AgentActivityPayload,
  type AgentEndPayload,
  type AgentErrorPayload,
  type AgentStartPayload,
  type ChatJoinPayload,
  type ChatMessagePayload,
  type SessionStatusPayload,
  type SessionStatusSnapshotPayload,
  SocketEvents,
  type SubagentRosterPayload,
} from "@tangent/shared/contracts.ts";
import { io, type Socket } from "socket.io-client";

import type { RunTracker } from "./runTracker.ts";

const RECONNECTION_ATTEMPTS = 10;

/** The login JWT inside the cookie header, named by the deployment's config. */
function loginToken(cookie: string | null): string | undefined {
  const name = process.env.AUTH_JWT_TOKEN_COOKIE_NAME;
  if (!cookie || !name) return undefined;
  const pair = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return pair?.slice(name.length + 1);
}

/** Opens the Shell's chat socket, authenticated with the user's cookie. */
export function connectShellSocket(
  shellUrl: string,
  cookie: string | null,
  onGiveUp: () => void,
): Socket {
  const url = new URL(shellUrl);
  const socket = io(url.origin, {
    path: `${url.pathname.replace(/\/+$/, "")}/socket.io/`,
    // Polling-to-websocket upgrades flap behind some auth proxies.
    transports: ["websocket"],
    reconnectionAttempts: RECONNECTION_ATTEMPTS,
    ...(cookie ? { extraHeaders: { cookie } } : {}),
    // Auth proxies can drop the cookie on a websocket upgrade, which makes the
    // Shell attribute messages to its anonymous user; the handshake token can't
    // be dropped that way.
    auth: { token: loginToken(cookie) },
  });
  socket.io.on("reconnect_failed", onGiveUp);
  return socket;
}

export interface PrimeChat {
  send(content: string): void;
  abort(): void;
  close(): void;
}

interface PrimeChatOptions {
  socket: Socket;
  sessionId: string;
  runs: RunTracker;
  log(text: string): void;
  /** Called once, when the first chat history has arrived. */
  onReady(): void;
}

/** Prime's thread id is server-assigned, learned from the roster. */
type PrimeThread = { conversationId?: string };

function listenConnection(options: PrimeChatOptions): void {
  const { socket, sessionId, runs, log } = options;
  socket.on("connect", () => {
    const join: ChatJoinPayload = { sessionId };
    socket.emit(SocketEvents.ChatJoin, join);
    socket.emit(SocketEvents.SessionStatusSubscribe);
  });
  socket.once(SocketEvents.ChatHistory, options.onReady);
  socket.on("connect_error", (error: Error) =>
    log(`connection error: ${error.message}`),
  );
  socket.on("disconnect", (reason: string) => {
    runs.disconnected();
    // Closing the pane disconnects on purpose.
    if (reason !== "io client disconnect") log(`disconnected (${reason})`);
    // socket.io does not retry after the server closes the socket itself.
    if (reason === "io server disconnect") socket.connect();
  });
  socket.on("error", (error: { message?: string }) =>
    runs.failed(error.message ?? "the Shell refused the message"),
  );
}

function listenPrime(options: PrimeChatOptions, prime: PrimeThread): void {
  const { socket, sessionId, runs, log } = options;
  const isPrime = (conversationId: string) =>
    conversationId === prime.conversationId;
  socket.on(
    SocketEvents.SessionStatusSnapshot,
    ({ statuses }: SessionStatusSnapshotPayload) => {
      // The snapshot leaves idle sessions out.
      const mine = statuses.find((s) => s.sessionId === sessionId);
      runs.status(mine?.status ?? "idle");
    },
  );
  socket.on(SocketEvents.SessionStatus, (update: SessionStatusPayload) => {
    if (update.sessionId === sessionId) runs.status(update.status);
  });
  socket.on(SocketEvents.SubagentRoster, (roster: SubagentRosterPayload) => {
    if (roster.sessionId === sessionId) {
      prime.conversationId = roster.primaryConversationId;
    }
  });
  socket.on(SocketEvents.AgentStart, ({ message }: AgentStartPayload) => {
    if (isPrime(message.conversationId)) runs.primeMessageStarted(message.id);
  });
  socket.on(SocketEvents.AgentEnd, ({ message }: AgentEndPayload) => {
    if (!isPrime(message.conversationId)) return;
    if (message.content.trim()) log(`Prime › ${message.content.trim()}`);
    runs.primeMessageEnded(message.id, message.content);
  });
  socket.on(SocketEvents.AgentActivity, (update: AgentActivityPayload) => {
    if (isPrime(update.conversationId) && update.activity?.kind === "tool") {
      log(`  · ${update.activity.label}`);
    }
  });
  socket.on(SocketEvents.AgentError, (error: AgentErrorPayload) => {
    // The bare "error" event covers failures with no message.
    if (error.sessionId === sessionId && error.messageId) {
      runs.failed(error.message, error.messageId);
    }
  });
}

/**
 * One session's Prime conversation over the Shell socket: sends messages and
 * feeds Prime's messages and the run status to the tracker.
 */
export function connectPrimeChat(options: PrimeChatOptions): PrimeChat {
  const { socket, sessionId, runs } = options;
  const prime: PrimeThread = {};
  listenConnection(options);
  listenPrime(options, prime);
  return {
    send(content) {
      const payload: ChatMessagePayload = {
        sessionId,
        content,
        ...(prime.conversationId
          ? { conversationId: prime.conversationId }
          : {}),
      };
      socket.emit(SocketEvents.ChatMessage, payload);
      runs.messageSent();
    },
    abort() {
      if (!prime.conversationId) return;
      const payload: AgentAbortPayload = {
        sessionId,
        conversationId: prime.conversationId,
      };
      socket.emit(SocketEvents.AgentAbort, payload);
    },
    close: () => void socket.close(),
  };
}
