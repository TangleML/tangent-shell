import type { BundleTrigger } from "@tangent/shared/configBundle.ts";
import type {
  ChatAuthor,
  RunIngress,
  SubagentStatus,
  Trigger,
  TriggerDisabledReason,
  TriggerRosterPayload,
  TriggerTarget,
  TriggerUpdatePayload,
} from "@tangent/shared/contracts.ts";
import {
  isTerminalStatus,
  SocketEvents,
  TRIGGER_AUTHOR,
} from "@tangent/shared/contracts.ts";
import { Cron } from "croner";
import type { Server } from "socket.io";

import type { ConversationRouter } from "../../conversation/conversationRouter.ts";
import {
  homeConversationFor,
  orchestratorConversationFor,
  orchestratorIdentity,
} from "../../conversation/participantRegistry.ts";
import type { ParticipantService } from "../../conversation/participantService.ts";
import { roomFor } from "../../sockets/rooms.ts";
import type { SessionStore } from "../../store/sessionStore.ts";
import type { SubagentSpawnRequest } from "../agentConfig.ts";
import type { PiAgentManager } from "../piAgentManager.ts";
import { parseDuration } from "./duration.ts";
import { resolveTriggerPrompt, TRIGGER_SKIPPED } from "./handlerRunner.ts";
import {
  type LifecycleCheck,
  retirementReason,
  retiresOnStatus,
  type TargetState,
} from "./triggerLifecycle.ts";
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

/**
 * How a firing ended: its prompt was `delivered`, its handler `skipped` the
 * tick, it was dropped as `busy` because the previous tick of the same trigger
 * was still in flight, or the trigger was `retired` (switched off) instead.
 */
export type FireOutcome = "delivered" | "skipped" | "busy" | "retired";

/** Key for a trigger's in-flight marker. */
function inFlightKey(sessionId: string, triggerId: string): string {
  return `${sessionId}:${triggerId}`;
}

/**
 * Drives triggers at runtime: arms schedule timers, runs the signal-to-prompt
 * transform, and posts the result into its target's Conversation exactly like a
 * user chat turn. One instance is shared across sessions; per-session schedule
 * handles are tracked here while definitions live in the {@link TriggerManager}.
 */
export class TriggerEngine {
  private readonly timers = new Map<string, Map<string, ScheduleHandle>>();
  /** Schedule ticks still being delivered, so a slow one never stacks up. */
  private readonly inFlight = new Set<string>();
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

  /** Reconciles a reinstalled bundle's triggers, then re-arms and broadcasts. */
  reseed(
    sessionId: string,
    rootPath: string,
    bundleTriggers: BundleTrigger[] | undefined,
  ): void {
    this.triggers.reconcileBundle(sessionId, rootPath, bundleTriggers);
    this.afterChange(sessionId, rootPath);
  }

  /**
   * Loads (if needed) and arms a session's schedules as it wakes (chat join,
   * unarchive). Idempotent — safe to call on every join to re-arm after a
   * server restart. Before arming, switches off triggers that should not come
   * back: expired, out of fires, or whose dedicated sub-agent ended — or, for a
   * schedule without an `expiresAt`, whose sub-agent is detached and not
   * running. Call it before reviving the session's sub-agents, so a revive
   * can't make a dormant watcher look live. Pass `resume` for a deliberate
   * wake (unarchive), which skips that dormancy rule.
   */
  async sync(
    sessionId: string,
    rootPath: string,
    check: "wake" | "resume" = "wake",
  ): Promise<void> {
    this.load(sessionId, rootPath);
    await this.retireStale(sessionId, check);
    this.arm(sessionId, rootPath);
  }

  /** Loads a session's triggers for listing without arming any schedule. */
  load(sessionId: string, rootPath: string): void {
    this.triggers.register(sessionId, rootPath);
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

  /**
   * Switches off a session's triggers that {@link retirementReason} says should
   * stop, broadcasting each change. Returns how many were retired.
   */
  private async retireStale(
    sessionId: string,
    check: LifecycleCheck,
  ): Promise<number> {
    const stored = this.triggers.listStored(sessionId);
    if (!stored.length) return 0;
    const targets = await this.targetStates(sessionId);
    const dormant: string[] = [];
    let retired = 0;
    for (const trigger of stored) {
      // Read before review: retiring forgets the trigger's sub-agent.
      const agentId = liveAgentId(trigger);
      const target = targetOf(trigger, targets);
      const reason = this.review(sessionId, trigger, target, check);
      if (!reason) continue;
      retired += 1;
      if (reason === "target-detached") dormant.push(agentId);
    }
    await this.completeDormantWorkers(sessionId, dormant);
    return retired;
  }

  /**
   * Checks one trigger: retires an enabled one that should stop (returning
   * why), and forgets a disabled one's ended sub-agent.
   */
  private review(
    sessionId: string,
    trigger: StoredTrigger,
    target: TargetState | undefined,
    check: LifecycleCheck,
  ): TriggerDisabledReason | undefined {
    if (!trigger.enabled) {
      this.forgetEndedTarget(sessionId, trigger, target?.status);
      return undefined;
    }
    const reason = retirementReason(trigger, target, check);
    return reason && this.retire(sessionId, trigger, reason)
      ? reason
      : undefined;
  }

  /**
   * Marks the sub-agents of watchers just retired as dormant `completed`, so
   * the revive that follows a wake doesn't bring them back as idle processes
   * with nothing to watch. Skips one another enabled trigger still uses.
   */
  private async completeDormantWorkers(
    sessionId: string,
    agentIds: string[],
  ): Promise<void> {
    const inUse = new Set(
      this.triggers
        .listStored(sessionId)
        .filter((trigger) => trigger.enabled)
        .map(liveAgentId),
    );
    for (const agentId of new Set(agentIds)) {
      if (!agentId || inUse.has(agentId)) continue;
      await this.store.setAgentStatus(sessionId, agentId, "completed");
    }
  }

  /** Forgets a disabled trigger's sub-agent once it has ended. */
  private forgetEndedTarget(
    sessionId: string,
    trigger: StoredTrigger,
    status: SubagentStatus | undefined,
  ): void {
    if (!status || !isTerminalStatus(status)) return;
    if (this.triggers.forgetTargetAgent(sessionId, trigger.id)) {
      const updated = this.triggers.get(sessionId, trigger.id);
      if (updated) this.emitUpdate(sessionId, updated);
    }
  }

  /**
   * Reacts to a sub-agent's status change: a trigger whose dedicated sub-agent
   * completed, was killed or errored — or dropped to `detached` without an
   * expiry to outlive it — is switched off rather than left to respawn a fresh
   * worker on its next tick.
   */
  onAgentStatus(
    sessionId: string,
    agentId: string,
    status: SubagentStatus,
  ): void {
    for (const trigger of this.triggers.listStored(sessionId)) {
      if (
        trigger.target.type !== "subagent" ||
        trigger.target.agentId !== agentId
      ) {
        continue;
      }
      if (!trigger.enabled) {
        this.forgetEndedTarget(sessionId, trigger, status);
        continue;
      }
      const reason = retiresOnStatus(trigger, status);
      if (reason) this.retire(sessionId, trigger, reason);
    }
  }

  /** Each sub-agent's persisted status and whether it is running here now. */
  private async targetStates(
    sessionId: string,
  ): Promise<Map<string, TargetState>> {
    const states = new Map<string, TargetState>();
    for (const agent of await this.store.listAgents(sessionId)) {
      if (agent.role !== "subagent") continue;
      states.set(agent.id, {
        status: agent.status,
        live: this.pi.hasAgent(sessionId, agent.id),
      });
    }
    return states;
  }

  /**
   * Switches one trigger off, stops its timer and tells the room. Returns false
   * when it was already off.
   */
  private retire(
    sessionId: string,
    trigger: StoredTrigger,
    reason: TriggerDisabledReason,
  ): boolean {
    const updated = this.triggers.retire(sessionId, trigger.id, reason);
    if (!updated) return false;
    console.log(
      `[triggers] disabled "${trigger.name}" in ${sessionId}: ${reason}`,
    );
    const handles = this.timers.get(sessionId);
    handles?.get(trigger.id)?.stop();
    handles?.delete(trigger.id);
    this.emitUpdate(sessionId, updated);
    return true;
  }

  /** Broadcasts one trigger's new state to the session room. */
  private emitUpdate(sessionId: string, trigger: Trigger): void {
    const payload: TriggerUpdatePayload = { sessionId, trigger };
    this.io.to(roomFor(sessionId)).emit(SocketEvents.TriggerUpdate, payload);
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
      void this.fireTick(sessionId, rootPath, trigger).catch((err) => {
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

    const ms = parseDuration(trigger.schedule?.every);
    if (!ms) {
      console.error(`[triggers] invalid schedule for "${trigger.name}"`);
      return undefined;
    }
    const handle = setInterval(run, Math.max(ms, MIN_INTERVAL_MS));
    return { stop: () => clearInterval(handle) };
  }

  /**
   * One schedule tick. Dropped while the previous tick of the same trigger is
   * still being delivered (e.g. a cold Prime/sub-agent spawn), so a slow
   * delivery can't queue a burst of prompts behind it.
   */
  async fireTick(
    sessionId: string,
    rootPath: string,
    trigger: StoredTrigger,
  ): Promise<FireOutcome> {
    const key = inFlightKey(sessionId, trigger.id);
    if (this.inFlight.has(key)) return "busy";
    this.inFlight.add(key);
    try {
      return await this.fire(sessionId, rootPath, trigger.id, {
        kind: "schedule",
        trigger: trigger.name,
        firedAt: new Date().toISOString(),
      });
    } finally {
      this.inFlight.delete(key);
    }
  }

  /**
   * Fires a trigger: resolves the signal into a prompt and delivers it to the
   * trigger's target — its dedicated sub-agent (default) or Prime — surfacing it
   * in that conversation's transcript exactly as a directed message would.
   *
   * Checks the trigger's lifetime first: one that expired, spent its fire
   * budget or whose sub-agent ended is switched off instead (`retired`). A
   * handler returning `{ skip: true }` drops the tick without waking anyone
   * (`skipped`); only delivered prompts count against `maxFires`.
   */
  async fire(
    sessionId: string,
    rootPath: string,
    triggerId: string,
    signal: unknown,
  ): Promise<FireOutcome> {
    const stored = this.triggers.getStored(sessionId, triggerId);
    if (!stored) throw new Error("trigger not found");
    if (!stored.enabled) throw new Error("trigger is disabled");
    if (await this.retireIfDone(sessionId, stored)) return "retired";

    const prompt = await resolveTriggerPrompt(rootPath, stored, signal);
    if (prompt === TRIGGER_SKIPPED) return "skipped";

    await this.deliver(sessionId, rootPath, stored, prompt);
    this.recordDelivery(sessionId, stored);
    return "delivered";
  }

  /** Delivers a resolved prompt to the trigger's target. */
  private async deliver(
    sessionId: string,
    rootPath: string,
    stored: StoredTrigger,
    prompt: string,
  ): Promise<void> {
    if (stored.target.type === "subagent") {
      await this.deliverToSubagent(sessionId, rootPath, stored, prompt);
    } else {
      await this.deliverToPrime(sessionId, rootPath, stored, prompt);
    }
  }

  /**
   * Counts a delivered firing, tells the room, and retires the trigger right
   * away when that firing spent its budget (or its lifetime ran out meanwhile).
   */
  private recordDelivery(sessionId: string, stored: StoredTrigger): void {
    this.triggers.markFired(sessionId, stored.id);
    const updated = this.triggers.get(sessionId, stored.id);
    if (updated) this.emitUpdate(sessionId, updated);
    const reason = retirementReason(stored, undefined, "fire");
    if (reason) this.retire(sessionId, stored, reason);
  }

  /** Retires a trigger about to fire if its lifetime says it is done. */
  private async retireIfDone(
    sessionId: string,
    stored: StoredTrigger,
  ): Promise<boolean> {
    const target =
      stored.target.type === "subagent" && stored.target.agentId
        ? (await this.targetStates(sessionId)).get(stored.target.agentId)
        : undefined;
    const reason = retirementReason(stored, target, "fire");
    return reason ? this.retire(sessionId, stored, reason) : false;
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
    const { orchestratorId, homeConversationId: primaryConversationId } =
      await orchestratorIdentity(this.store, sessionId);
    await this.ensurePrime(sessionId, rootPath, primaryConversationId);
    await this.ensureTriggerParticipant(sessionId, stored);
    await this.conversations.post({
      sessionId,
      conversationId: primaryConversationId,
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
    const { agentId } = await this.ensureSubagent(sessionId, rootPath, stored);
    await this.ensureTriggerParticipant(sessionId, stored);
    await this.conversations.post({
      sessionId,
      conversationId: await homeConversationFor(this.store, sessionId, agentId),
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
  async provision(
    sessionId: string,
    rootPath: string,
    triggerId: string,
  ): Promise<void> {
    const stored = this.triggers.getStored(sessionId, triggerId);
    if (!stored || stored.target.type !== "subagent") return;
    await this.ensureSubagent(sessionId, rootPath, stored);
  }

  /** Spawns the session's Prime if needed, with its persisted env and home. */
  private async ensurePrime(
    sessionId: string,
    rootPath: string,
    homeConversationId?: string,
  ): Promise<void> {
    await this.pi.ensure(sessionId, rootPath, {
      homeConversationId:
        homeConversationId ??
        (await orchestratorConversationFor(this.store, sessionId)),
      env: await this.store.getSessionEnv(sessionId),
    });
  }

  /**
   * Ensures the trigger's dedicated sub-agent is live, reusing the recorded one
   * when present or spawning a fresh one from the stored spec. Persists the live
   * sub-agent id back onto the trigger and the session's agent roster.
   */
  private async ensureSubagent(
    sessionId: string,
    rootPath: string,
    stored: StoredTrigger,
  ): Promise<{ agentId: string; agentName: string }> {
    // The session/Prime record must exist before a sub-agent can be spawned.
    await this.ensurePrime(sessionId, rootPath);

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

    return callbackResult(
      await this.fire(sessionId, session.rootPath, triggerId, signal),
    );
  }
}

/** The id of a trigger's recorded live sub-agent, or `""` when it has none. */
function liveAgentId(trigger: StoredTrigger): string {
  if (trigger.target.type !== "subagent") return "";
  return trigger.target.agentId ?? "";
}

/** What a callback firing answers: a trigger retired instead reads disabled. */
function callbackResult(outcome: FireOutcome): "ok" | "disabled" {
  return outcome === "retired" ? "disabled" : "ok";
}

/** The known state of a trigger's dedicated sub-agent, if it targets one. */
function targetOf(
  trigger: StoredTrigger,
  targets: Map<string, TargetState>,
): TargetState | undefined {
  if (trigger.target.type !== "subagent" || !trigger.target.agentId) {
    return undefined;
  }
  return targets.get(trigger.target.agentId);
}
