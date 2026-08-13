import type { BundleTrigger } from "@tangent/shared/configBundle.ts";
import type {
  ChatAuthor,
  RunIngress,
  Trigger,
  TriggerRosterPayload,
  TriggerTarget,
  TriggerUpdatePayload,
} from "@tangent/shared/contracts.ts";
import { SocketEvents, TRIGGER_AUTHOR } from "@tangent/shared/contracts.ts";
import { Cron } from "croner";
import type { Server } from "socket.io";

import type { ConversationRouter } from "../../conversation/conversationRouter.ts";
import { orchestratorIdFor } from "../../conversation/participantRegistry.ts";
import type { ParticipantService } from "../../conversation/participantService.ts";
import { roomFor } from "../../sockets/rooms.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import type { SubagentSpawnRequest } from "../agentConfig.ts";
import type { PiAgentManager } from "../piAgentManager.ts";
import { resolveTriggerPrompt } from "./handlerRunner.ts";
import type { StoredTrigger, TriggerManager } from "./triggerManager.ts";

/** Floor on a schedule interval so a bad `every` can't busy-loop the server. */
const MIN_INTERVAL_MS = 1000;

/** A handle to a single armed schedule, abstracting interval vs cron. */
interface ScheduleHandle {
  stop: () => void;
}

/** Author attributed to a trigger's delivered prompt (labelled by the trigger). */
function triggerAuthor(stored: StoredTrigger): ChatAuthor {
  return { ...TRIGGER_AUTHOR, name: stored.title ?? stored.name };
}

/** What a firing counts as when it opens a Run: the trigger's own signal. */
function ingressFor(stored: StoredTrigger): RunIngress {
  return stored.kind === "schedule" ? "schedule" : "webhook";
}

/** Builds the spawn request that revives a `subagent`-target trigger's sub-agent. */
function buildSubagentSpawnRequest(
  target: Extract<TriggerTarget, { type: "subagent" }>,
  stored: StoredTrigger,
): SubagentSpawnRequest {
  return {
    name: target.spec.name ?? stored.title ?? stored.name,
    template: target.spec.template,
    systemPrompt: target.spec.systemPrompt,
    tools: target.spec.tools,
    model: target.spec.model,
    thinkingDepth: target.spec.thinkingDepth,
    autoRelayToPrime: false,
  };
}

/** Parses a duration string (`"1h"`, `"30m"`, `"45s"`, `"2d"`) into ms. */
function parseEvery(every: string | undefined): number | undefined {
  if (!every) return undefined;
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(every.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2];
  const factor =
    unit === "s"
      ? 1000
      : unit === "m"
        ? 60_000
        : unit === "h"
          ? 3_600_000
          : 86_400_000;
  return value * factor;
}

/**
 * Drives triggers at runtime: arms schedule timers, runs the signal-to-prompt
 * transform, and posts the result into its target's Conversation exactly like a
 * user chat turn. One instance is shared across sessions; per-session schedule
 * handles are tracked here while definitions live in the {@link TriggerManager}.
 */
export class TriggerEngine {
  private readonly timers = new Map<string, Map<string, ScheduleHandle>>();
  private readonly io: Server;
  private readonly store: SessionStore;
  private readonly pi: PiAgentManager;
  private readonly triggers: TriggerManager;
  private readonly conversations: ConversationRouter;
  private readonly participants: ParticipantService | undefined;

  constructor(
    io: Server,
    store: SessionStore,
    pi: PiAgentManager,
    triggers: TriggerManager,
    conversations: ConversationRouter,
    participants?: ParticipantService,
  ) {
    this.io = io;
    this.store = store;
    this.pi = pi;
    this.triggers = triggers;
    this.conversations = conversations;
    this.participants = participants;
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
        console.error(`[triggers] invalid cron for "${trigger.name}":`, err);
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
   * Fires a trigger: resolves the signal into a prompt and delivers it to the
   * trigger's target — its dedicated sub-agent (default) or Prime — surfacing it
   * in that conversation's transcript exactly as a directed message would.
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

    if (stored.target.type === "subagent") {
      await this.deliverToSubagent(sessionId, rootPath, stored, prompt);
    } else {
      await this.deliverToPrime(sessionId, rootPath, stored, prompt);
    }

    this.triggers.markFired(sessionId, triggerId);
    const updated = this.triggers.get(sessionId, triggerId);
    if (updated) {
      const payload: TriggerUpdatePayload = { sessionId, trigger: updated };
      this.io.to(roomFor(sessionId)).emit(SocketEvents.TriggerUpdate, payload);
    }
  }

  /**
   * Delivers a firing to Prime (the legacy, discouraged path): posts it into
   * Prime's Conversation addressed to Prime — spawning Prime first if needed,
   * since a cold session has nothing to wake.
   */
  private async deliverToPrime(
    sessionId: string,
    rootPath: string,
    stored: StoredTrigger,
    prompt: string,
  ): Promise<void> {
    this.pi.ensure(sessionId, rootPath);
    const orchestratorId = await orchestratorIdFor(this.store, sessionId);
    await this.ensureTriggerParticipant(sessionId, stored);
    await this.conversations.post({
      sessionId,
      conversationId: orchestratorId,
      author: triggerAuthor(stored),
      content: prompt,
      mentions: [orchestratorId],
      ingress: ingressFor(stored),
    });
  }

  /**
   * Delivers a firing to the trigger's dedicated sub-agent: revives it from the
   * stored spec if it died (or after a restart), then posts the prompt into its
   * Conversation addressed to it. The sub-agent works in isolation — Prime does
   * not react to its replies, though it may reach Prime by addressing it.
   */
  private async deliverToSubagent(
    sessionId: string,
    rootPath: string,
    stored: StoredTrigger,
    prompt: string,
  ): Promise<void> {
    const { agentId } = this.ensureSubagent(sessionId, rootPath, stored);
    await this.ensureTriggerParticipant(sessionId, stored);
    await this.conversations.post({
      sessionId,
      conversationId: agentId,
      author: triggerAuthor(stored),
      content: prompt,
      mentions: [agentId],
      ingress: ingressFor(stored),
    });
  }

  /**
   * Materializes the trigger Automation Participant once per session, so the
   * actor behind a firing is a real, listable row. The delivered Message still
   * carries the TRIGGER_AUTHOR label (its title-specific name).
   */
  private async ensureTriggerParticipant(
    sessionId: string,
    stored: StoredTrigger,
  ): Promise<void> {
    await this.participants?.ensureAutomation(
      sessionId,
      TRIGGER_AUTHOR.id,
      TRIGGER_AUTHOR.name,
      ingressFor(stored),
    );
  }

  /**
   * Eagerly spawns a freshly created `subagent`-target trigger's sub-agent so it
   * exists before the first firing. No-op for a Prime-target or unknown trigger.
   */
  provision(sessionId: string, rootPath: string, triggerId: string): void {
    const stored = this.triggers.getStored(sessionId, triggerId);
    if (!stored || stored.target.type !== "subagent") return;
    this.ensureSubagent(sessionId, rootPath, stored);
  }

  /**
   * Ensures the trigger's dedicated sub-agent is live, reusing the recorded one
   * when present or spawning a fresh one from the stored spec. Persists the live
   * sub-agent id back onto the trigger and the session's agent roster.
   */
  private ensureSubagent(
    sessionId: string,
    rootPath: string,
    stored: StoredTrigger,
  ): { agentId: string; agentName: string } {
    // The session/Prime record must exist before a sub-agent can be spawned.
    this.pi.ensure(sessionId, rootPath);

    const target = stored.target;
    if (target.type !== "subagent") {
      throw new Error("trigger target is not a sub-agent");
    }
    if (target.agentId && this.pi.hasAgent(sessionId, target.agentId)) {
      return {
        agentId: target.agentId,
        agentName: target.agentName ?? stored.name,
      };
    }

    const request = buildSubagentSpawnRequest(target, stored);
    const { info, tools, systemPrompt, autoRelayToPrime } =
      this.pi.spawnSubagent(sessionId, request);
    this.triggers.setTargetAgent(sessionId, stored.id, info.id, info.name);
    void this.store.recordAgent(sessionId, {
      id: info.id,
      role: "subagent",
      name: info.name,
      status: "active",
      model: info.model,
      thinkingDepth: info.thinkingDepth,
      template: info.template,
      tools,
      systemPrompt,
      autoRelayToPrime,
    });
    return { agentId: info.id, agentName: info.name };
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
