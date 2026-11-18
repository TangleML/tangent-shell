import "@tangent/local-agent-host/loadEnv.ts";

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import { peekOktassoCookie } from "@tangent/local-agent-host/oktasso.ts";
import { createOktassoFetch } from "@tangent/local-agent-host/oktassoFetch.ts";
import type { WorkflowViewResponse } from "@tangent/shared/contracts.ts";

import { parseConfig, type WorkerConfig } from "./config.ts";
import { createHerdr, type Herdr } from "./herdr.ts";
import { type FetchFor, requestJson } from "./http.ts";
import {
  connectPrimeChat,
  connectShellSocket,
  type PrimeChat,
} from "./primeChat.ts";
import type { OpenedSession } from "./project.ts";
import { type OpenWorkCheck, RunTracker } from "./runTracker.ts";
import { openSession } from "./session.ts";

const HELP = `Usage:
  tangent-prime-worker --new <title> --project <id|link> [--tangle <url>]
  tangent-prime-worker --new <title> --workspace <name|id> [--tangle <url>]
  tangent-prime-worker --session <id|url> [--url <shell url>]
  tangent-prime-worker --new <title> --bundle <id> --url <shell url>

--project starts the session in that Tangle project and --workspace in a new
project named <title>, on the workspace's Tangent Shell, so it is listed in the
project. TANGLE_URL is the default --tangle; a project link supplies it.

Chats with one Tangent session's Prime as a worker pane for an orchestrator
such as herdr. Type a message, or "/file <path>" to send a file as one message.
Ctrl-C stops Prime's current run; Ctrl-C again or Ctrl-D exits.
Each reply is saved to ~/.cache/tangent-prime-worker/<session id>/last-reply.md
before the pane reports idle. TANGENT_SHELL_URL is the default --url.`;

const FILE_COMMAND = "/file ";
// socket.io's default server limit is 1 MB; a bigger message drops the socket.
const MAX_FILE_BYTES = 900_000;
const NO_TEXT_REPLY = "(Prime sent no text in this run.)";
const RUN_IN_PROGRESS_REPLY =
  "(Prime is still working on the latest message; this file is replaced when it finishes.)";

async function messageFor(text: string): Promise<string> {
  if (!text.startsWith(FILE_COMMAND)) return text;
  const filePath = text.slice(FILE_COMMAND.length).trim();
  if ((await stat(filePath)).size > MAX_FILE_BYTES) {
    throw new Error(`${filePath} is over ${MAX_FILE_BYTES / 1000} KB`);
  }
  const content = (await readFile(filePath, "utf8")).trim();
  if (!content) throw new Error(`${filePath} is empty`);
  return content;
}

async function saveReply(file: string, reply: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${reply.trim() || NO_TEXT_REPLY}\n`, { mode: 0o600 });
}

/** One fetch per site, so each site signs in once and keeps its own cookie. */
function fetchPerOrigin(): FetchFor {
  const fetches = new Map<string, typeof fetch>();
  return (url) => {
    const origin = new URL(url).origin;
    const known = fetches.get(origin) ?? createOktassoFetch(origin);
    fetches.set(origin, known);
    return known;
  };
}

/**
 * Opens the session with the pane already reported as working, so herdr knows
 * the agent while sign-in runs; a failed start reports idle before exiting.
 */
async function startSession(
  config: WorkerConfig,
  herdr: Herdr,
  fetchFor: FetchFor,
): Promise<OpenedSession> {
  await herdr.report("working");
  try {
    return await openSession(config, fetchFor);
  } catch (error) {
    await herdr.report("idle");
    throw error;
  }
}

/** Helpers outside the Shell (attached, remote, A2A) show up as open runs here. */
function openWorkCheck(
  shellUrl: string,
  sessionId: string,
  shell: typeof fetch,
): OpenWorkCheck {
  const url = `${shellUrl}/api/sessions/${encodeURIComponent(sessionId)}/workflow`;
  return async () => {
    const { workflow } = await requestJson<WorkflowViewResponse>(shell, url);
    return workflow.runs.length > 0;
  };
}

function replyFileFor(sessionId: string): string {
  return path.join(
    os.homedir(),
    ".cache",
    "tangent-prime-worker",
    sessionId,
    "last-reply.md",
  );
}

function printHeader(opened: OpenedSession, replyFile: string): void {
  const { session, projectUrl, warning } = opened;
  console.log(`Tangent Prime · ${session.name}\nsession ${session.id}`);
  if (projectUrl) console.log(`project ${projectUrl}`);
  if (warning) console.log(`warning: ${warning}`);
  console.log(`replies ${replyFile}`);
}

/** Prints over the input prompt, so Prime's lines don't interleave with it. */
function log(text: string): void {
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  console.log(text);
}

/** Routes pane input: messages and `/file` to Prime, Ctrl-C to abort or exit. */
function bindInput(
  input: readline.Interface,
  runs: RunTracker,
  chat: PrimeChat,
  log: (text: string) => void,
  shutdown: (exitCode: number) => void,
): void {
  let stopping = false;
  input.on("line", (line) => {
    stopping = false;
    const text = line.trim();
    if (!text) return input.prompt();
    messageFor(text).then(chat.send, (error: Error) => {
      log(`could not send: ${error.message}`);
      input.prompt();
    });
  });
  input.on("SIGINT", () => {
    if (!runs.isRunning || stopping) return input.close();
    stopping = true;
    log("stopping Prime's run…");
    chat.abort();
  });
  input.on("close", () => shutdown(0));
  for (const signal of ["SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => input.close());
  }
}

async function runWorker(argv: string[]): Promise<void> {
  const config = parseConfig(argv);
  const herdr = createHerdr();
  const fetchFor = fetchPerOrigin();
  const { session, shellUrl, projectUrl, warning } = await startSession(
    config,
    herdr,
    fetchFor,
  );
  // The REST calls above ran any sign-in, so a protected Shell's cookie is cached.
  const cookie = await peekOktassoCookie(new URL(shellUrl).origin);
  const replyFile = replyFileFor(session.id);
  printHeader({ session, shellUrl, projectUrl, warning }, replyFile);

  const input = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "you › ",
  });
  const save = (reply: string) => () =>
    saveReply(replyFile, reply).catch((error: Error) =>
      log(`could not save the reply: ${error.message}`),
    );
  const runs = new RunTracker(
    // Cleared at the start, so a reply on disk always belongs to the latest run.
    () => void herdr.report("working", save(RUN_IN_PROGRESS_REPLY)),
    // The reply is on disk before idle, and idle is reported even if saving fails.
    (reply) =>
      void herdr.report("idle", save(reply)).then(() => input.prompt()),
    openWorkCheck(shellUrl, session.id, fetchFor(shellUrl)),
  );
  const shutdown = (exitCode: number) => {
    chat.close();
    void herdr.release().then(() => process.exit(exitCode));
  };
  const giveUp = () => {
    console.error(
      `tangent-prime-worker: lost the Shell connection; restart with --session ${session.id} to sign in again.`,
    );
    shutdown(1);
  };
  const chat = connectPrimeChat({
    socket: connectShellSocket(shellUrl, cookie, giveUp),
    sessionId: session.id,
    runs,
    log,
    // Rejoining while Prime is mid-run must not report idle; the run's end will.
    onReady: () => {
      if (!runs.isRunning) void herdr.report("idle").then(() => input.prompt());
    },
  });

  bindInput(input, runs, chat, log, shutdown);
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) {
  console.log(HELP);
} else {
  runWorker(argv).catch((error: Error) => {
    console.error(`tangent-prime-worker: ${error.message}`);
    process.exit(1);
  });
}
