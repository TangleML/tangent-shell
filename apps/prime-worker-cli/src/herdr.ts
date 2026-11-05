import net from "node:net";

type HerdrAgentState = "idle" | "working";

export interface Herdr {
  /** Runs `before` (errors are the caller's), then reports, in call order. */
  report(state: HerdrAgentState, before?: () => Promise<void>): Promise<void>;
  release(): Promise<void>;
}

// herdr reserves the "herdr:" prefix for its own integrations.
const SOURCE = "tangent-prime-worker";
const REQUEST_TIMEOUT_MS = 1500;

function sendRequest(socketPath: string, request: object): Promise<void> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    const finish = () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    };
    const timer = setTimeout(finish, REQUEST_TIMEOUT_MS);
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", finish);
    socket.on("error", finish);
  });
}

/**
 * Reports this pane's agent state over herdr's local socket so an orchestrator
 * can `herdr agent wait` on it. A no-op outside herdr.
 */
export function createHerdr(env: NodeJS.ProcessEnv = process.env): Herdr {
  const socketPath = env.HERDR_SOCKET_PATH;
  const paneId = env.HERDR_PANE_ID;
  if (env.HERDR_ENV !== "1" || !socketPath || !paneId) {
    return {
      report: async (_state, before) => before?.(),
      release: async () => {},
    };
  }
  // herdr drops reports whose seq is not newer than the last one it saw, and a
  // restarted worker must outrank the previous process in the same pane.
  let seq = Date.now() * 1000;
  // One at a time, so a late "idle" can never land after the next "working".
  let tail: Promise<void> = Promise.resolve();
  const send = (method: string, params: object): Promise<void> => {
    tail = tail.then(() => {
      seq += 1;
      const id = `${SOURCE}:${seq}`;
      const base = { pane_id: paneId, source: SOURCE, agent: "tangent", seq };
      return sendRequest(socketPath, {
        id,
        method,
        params: { ...base, ...params },
      });
    });
    return tail;
  };
  return {
    report: (state, before) => {
      if (before) tail = tail.then(before).catch(() => {});
      return send("pane.report_agent", { state, message: null });
    },
    release: () => send("pane.release_agent", {}),
  };
}
