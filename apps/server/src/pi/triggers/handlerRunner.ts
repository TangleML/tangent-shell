import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { renderPrompt } from "./promptTemplate.ts";
import type { StoredTrigger } from "./triggerManager.ts";

/** Hard wall-clock budget for a handler before its worker is terminated. */
const DEFAULT_TIMEOUT_MS = 5000;

/** Defensive cap on the prompt a handler may return. */
const MAX_PROMPT_LENGTH = 16_000;

/** Memory ceiling for a handler worker, keeping a runaway transform bounded. */
const MAX_OLD_GENERATION_MB = 64;

/**
 * Worker bootstrap appended after the compiled handler. The handler is compiled
 * to an IIFE exposing `__tgHandler` (its module namespace), so this picks the
 * default export, invokes it with the signal from `workerData`, and posts the
 * result (or error) back. Runs in CommonJS scope (`eval` worker), so `require`
 * is available for any Node built-ins the bundled handler references.
 */
const BOOTSTRAP = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  try {
    const ns = (typeof __tgHandler !== 'undefined') ? __tgHandler : undefined;
    const fn = ns && ns.default ? ns.default : ns;
    if (typeof fn !== 'function') {
      throw new Error('trigger handler must default-export a function');
    }
    const result = await fn(workerData.signal);
    parentPort.postMessage({ ok: true, value: result });
  } catch (err) {
    const message = err && err.message ? String(err.message) : String(err);
    parentPort.postMessage({ ok: false, error: message });
  }
})();
`;

/** Message a handler worker posts back to the main thread. */
interface HandlerMessage {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/**
 * What resolving a firing produced: the prompt to deliver, or
 * {@link TRIGGER_SKIPPED} when the handler decided the tick isn't worth an
 * agent turn.
 */
export const TRIGGER_SKIPPED: unique symbol = Symbol("trigger-skipped");
export type ResolvedTriggerPrompt = string | typeof TRIGGER_SKIPPED;

/** Whether a handler returned the `{ skip: true }` sentinel. */
function isSkip(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { skip?: unknown }).skip === true
  );
}

/** The `prompt` of a `{ prompt }` result, else the value itself. */
function promptField(value: unknown): unknown {
  if (value && typeof value === "object" && "prompt" in value) {
    return (value as { prompt: unknown }).prompt;
  }
  return value;
}

/**
 * Coerces a handler's return value into a non-empty, bounded prompt string, or
 * {@link TRIGGER_SKIPPED} for `{ skip: true }` — a deterministic check found
 * nothing to report, so no agent is woken. Any other empty result is still an
 * error, since it more likely means a handler forgot to return.
 */
function coercePrompt(value: unknown): ResolvedTriggerPrompt {
  if (isSkip(value)) return TRIGGER_SKIPPED;
  const text = promptField(value);
  if (typeof text !== "string") {
    throw new Error(
      "trigger handler must return a string, { prompt: string } or { skip: true }",
    );
  }
  const trimmed = text.trim();
  if (!trimmed) throw new Error("trigger handler returned an empty prompt");
  return trimmed.slice(0, MAX_PROMPT_LENGTH);
}

/**
 * Runs a compiled trigger handler in an isolated worker thread. The worker gets
 * an empty environment (no access to the server's secrets), a memory ceiling,
 * and a wall-clock timeout enforced by terminating the thread — so a hung or
 * runaway transform can't stall or crash the server.
 *
 * The handler is trusted bundle-author code (the same trust model as Pi tool
 * extensions); the worker is for fault isolation and a hard timeout, not a
 * security boundary against deliberately malicious code.
 */
export async function runTriggerHandler(
  handlerAbsPath: string,
  signal: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ResolvedTriggerPrompt> {
  if (!existsSync(handlerAbsPath)) {
    throw new Error(`trigger handler not found: ${handlerAbsPath}`);
  }
  const compiled = readFileSync(handlerAbsPath, "utf8");
  const code = `${compiled}\n${BOOTSTRAP}`;

  return await new Promise<ResolvedTriggerPrompt>((resolve, reject) => {
    const worker = new Worker(code, {
      eval: true,
      workerData: { signal },
      env: {},
      argv: [],
      resourceLimits: { maxOldGenerationSizeMb: MAX_OLD_GENERATION_MB },
    });

    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(new Error(`trigger handler timed out after ${timeoutMs}ms`)),
      );
    }, timeoutMs);

    worker.on("message", (message: HandlerMessage) => {
      finish(() => {
        if (!message.ok) {
          reject(new Error(message.error ?? "trigger handler failed"));
          return;
        }
        try {
          resolve(coercePrompt(message.value));
        } catch (err) {
          reject(err as Error);
        }
      });
    });

    worker.on("error", (err) => finish(() => reject(err)));
  });
}

/**
 * Resolves a trigger firing into the prompt text delivered to its target, or
 * {@link TRIGGER_SKIPPED} when its handler skipped the tick. Prefers a compiled
 * handler when present; otherwise renders the prompt template against the
 * signal. Falls back to the template if a declared handler hasn't been
 * compiled. Throws when neither is available.
 */
export async function resolveTriggerPrompt(
  rootPath: string,
  trigger: StoredTrigger,
  signal: unknown,
): Promise<ResolvedTriggerPrompt> {
  if (trigger.handlerPath) {
    const abs = path.join(rootPath, ...trigger.handlerPath.split("/"));
    if (existsSync(abs)) return await runTriggerHandler(abs, signal);
  }
  if (trigger.prompt) return renderPrompt(trigger.prompt, signal);
  throw new Error(
    `trigger "${trigger.name}" has neither a compiled handler nor a prompt`,
  );
}
