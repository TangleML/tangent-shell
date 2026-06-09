import { randomUUID } from "node:crypto";

import type { BundleTrigger } from "@shared/configBundle.ts";
import type {
  ChatMessage,
  Trigger,
  TriggerRosterPayload,
  TriggerUpdatePayload,
} from "@shared/contracts.ts";
import { SocketEvents, TRIGGER_AUTHOR } from "@shared/contracts.ts";
import { Cron } from "croner";
import type { Server } from "socket.io";

import type { SessionStore } from "../../store/sessionStore.ts";
import { type PiAgentManager,PRIME_AGENT_ID } from "../piAgentManager.ts";
import { resolveTriggerPrompt } from "./handlerRunner.ts";
import type { StoredTrigger, TriggerManager } from "./triggerManager.ts";

/** Floor on a schedule interval so a bad `every` can't busy-loop the server. */
const MIN_INTERVAL_MS = 1000;

/** A handle to a single armed schedule, abstracting interval vs cron. */
interface ScheduleHandle {
  stop: () => void;
}

function roomFor(sessionId: string): string {
  return `session:${sessionId}`;
}

/** Parses a duration string (`"1h"`, `"30m"`, `"45s"`, `"2d"`) into ms. */
function parseEvery(every: string | undefined): number | undefined {
  if (!every) return undefined;
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(every.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2];
  const factor = unit === "s" ? 1000
    : unit === "m" ? 60_000
    : unit === "h" ? 3_600_000
    : 86_400_000;
  return value * factor;
}

/**
 * Drives triggers at runtime: arms schedule timers, runs the signal-to-prompt
 * transform, and delivers the result to Prime exactly like a user chat turn
 * (persist + broadcast + `pi.prompt`). One instance is shared across sessions;
 * per-session schedule handles are tracked here while definitions live in the
 * {@link TriggerManager}.
 */
export class TriggerEngine {
  private readonly timers = new Map<string, Map<string, ScheduleHandle>>();
  private readonly io: Server;
  private readonly store: SessionStore;
  private readonly pi: PiAgentManager;
  private readonly triggers: TriggerManager;

  constructor(
    io: Server,
    store: SessionStore,
    pi: PiAgentManager,
    triggers: TriggerManager,
  ) {
    this.io = io;
    this.store = store;
    this.pi = pi;
    this.triggers = triggers;
  }

  /** Seeds a bundle's triggers into a new session and arms its schedules. */
  seed(
    sessionId: string,
    rootPath: string,
    bundleTriggers: BundleTrigger[] | undefined,
  ): void {
    this.triggers.seedFromBundle(sessionId, rootPath, bundleTriggers);
    this.arm(sessionId, rootPath);
  }

  /**
   * Loads (if needed) and arms a session's schedules. Idempotent — safe to call
   * on chat join to re-arm after a server restart.
   */
  sync(sessionId: string, rootPath: string): void {
    this.triggers.register(sessionId, rootPath);
    this.arm(sessionId, rootPath);
  }

  /**
   * Re-arms after a trigger change and broadcasts the updated roster to the
   * session room so connected clients refresh.
   */
  afterChange(sessionId: string, rootPath: string): void {
    this.arm(sessionId, rootPath);
    const payload: TriggerRosterPayload = {
      sessionId,
      triggers: this.triggers.list(sessionId),
    };
    this.io.to(roomFor(sessionId)).emit(SocketEvents.TriggerRoster, payload);
  }

  /** Lists a session's triggers (wire contracts) from the store. */
  list(sessionId: string): Trigger[] {
    return this.triggers.list(sessionId);
  }

  /** Tears down a session's schedules and drops its in-memory trigger state. */
  dispose(sessionId: string): void {
    this.disarm(sessionId);
    this.triggers.dispose(sessionId);
  }

  /** Clears every armed schedule for a session. */
  disarm(sessionId: string): void {
    const handles = this.timers.get(sessionId);
    if (!handles) return;
    for (const handle of handles.values()) handle.stop();
    this.timers.delete(sessionId);
  }

  /** (Re)arms schedule timers from the current stored triggers. */
  private arm(sessionId: string, rootPath: string): void {
    this.disarm(sessionId);
    const handles = new Map<string, ScheduleHandle>();
    for (const trigger of this.triggers.listStored(sessionId)) {
      if (trigger.kind !== "schedule" || !trigger.enabled) continue;
      const handle = this.armOne(sessionId, rootPath, trigger);
      if (handle) handles.set(trigger.id, handle);
    }
    if (handles.size > 0) this.timers.set(sessionId, handles);
  }

  /** Arms a single schedule trigger (interval or cron). */
  private armOne(
    sessionId: string,
    rootPath: string,
    trigger: StoredTrigger,
  ): ScheduleHandle | undefined {
    const run = (): void => {
      void this.fire(sessionId, rootPath, trigger.id, {
        kind: "schedule",
        trigger: trigger.name,
        firedAt: new Date().toISOString(),
      }).catch((err) => {
        console.error(`[triggers] schedule "${trigger.name}" failed:`, err);
      });
    };

    if (trigger.schedule?.cron) {
      try {
        const cron = new Cron(trigger.schedule.cron, run);
        return { stop: () => cron.stop() };
      } catch (err) {
        console.error(
          `[triggers] invalid cron for "${trigger.name}":`,
          err,
        );
        return undefined;
      }
    }

    const ms = parseEvery(trigger.schedule?.every);
    if (!ms) {
      console.error(`[triggers] invalid schedule for "${trigger.name}"`);
      return undefined;
    }
    const handle = setInterval(run, Math.max(ms, MIN_INTERVAL_MS));
    return { stop: () => clearInterval(handle) };
  }

  /**
   * Fires a trigger: resolves the signal into a prompt, surfaces it in the
   * transcript (attributed to the trigger), and relays it to Prime — spawning
   * Prime if needed, exactly as a user message would.
   */
  async fire(
    sessionId: string,
    rootPath: string,
    triggerId: string,
    signal: unknown,
  ): Promise<void> {
    const stored = this.triggers.getStored(sessionId, triggerId);
    if (!stored) throw new Error("trigger not found");
    if (!stored.enabled) throw new Error("trigger is disabled");

    const prompt = await resolveTriggerPrompt(rootPath, stored, signal);

    const message: ChatMessage = {
      id: randomUUID(),
      sessionId,
      conversationId: PRIME_AGENT_ID,
      author: { ...TRIGGER_AUTHOR, name: stored.title ?? stored.name },
      content: prompt,
      createdAt: new Date().toISOString(),
    };
    await this.store.appendMessage(message);
    this.io.to(roomFor(sessionId)).emit(SocketEvents.ChatMessage, message);

    this.pi.prompt(sessionId, rootPath, prompt);

    this.triggers.markFired(sessionId, triggerId);
    const updated = this.triggers.get(sessionId, triggerId);
    if (updated) {
      const payload: TriggerUpdatePayload = { sessionId, trigger: updated };
      this.io.to(roomFor(sessionId)).emit(SocketEvents.TriggerUpdate, payload);
    }
  }

  /**
   * Validates a callback's secret and fires the trigger. Returns a sentinel for
   * the route to map to an HTTP status; throws only on internal failure.
   */
  async fireCallback(
    sessionId: string,
    triggerId: string,
    secret: string,
    signal: unknown,
  ): Promise<"ok" | "not-found" | "forbidden" | "disabled"> {
    const session = await this.store.getSession(sessionId);
    if (!session) return "not-found";

    this.triggers.register(sessionId, session.rootPath);
    const stored = this.triggers.getStored(sessionId, triggerId);
    if (!stored || stored.kind !== "callback") return "not-found";
    // An absent secret never equals the URL segment, so this also rejects
    // triggers somehow missing a secret.
    if (stored.secret !== secret) return "forbidden";
    if (!stored.enabled) return "disabled";

    await this.fire(sessionId, session.rootPath, triggerId, signal);
    return "ok";
  }
}
