import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { BundleTrigger } from "@tangent/shared/configBundle.ts";
import { BUNDLE_DIRS } from "@tangent/shared/configBundle.ts";
import type {
  CreateTriggerRequest,
  Trigger,
  TriggerKind,
  TriggerSchedule,
  TriggerSource,
  TriggerTarget,
  UpdateTriggerRequest,
} from "@tangent/shared/contracts.ts";

import type { RunDelegation } from "../../runs/runRegistry.ts";
import type { TriggerDelegationStore } from "../../store/triggerDelegationStore.ts";
import { TANGENT_DIRNAME } from "../config/bundleLoader.ts";

/** Filename, under a session's `.tangent/`, that persists its triggers. */
const TRIGGERS_FILENAME = "triggers.json";

/** Slug rule for a trigger name (matches the bundle manifest's rule). */
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * A trigger as persisted on disk. Mirrors the wire {@link Trigger} but keeps
 * server-only fields: the callback `secret` (embedded in the URL rather than
 * surfaced as a field) and `handlerPath` (the compiled transform's location,
 * relative to the session root).
 */
export interface StoredTrigger {
  id: string;
  name: string;
  kind: TriggerKind;
  title?: string;
  prompt?: string;
  /** Path (relative to the session root) of the compiled handler JS, if any. */
  handlerPath?: string;
  schedule?: TriggerSchedule;
  enabled: boolean;
  source: TriggerSource;
  /**
   * Where firings are delivered. Persisted so a `subagent` target's revival
   * spec and currently-live sub-agent id survive a restart.
   */
  target: TriggerTarget;
  /** Secret embedded in the callback URL (callback kind only). */
  secret?: string;
  participantId?: string;
  delegationId?: string;
  createdAt: string;
  updatedAt: string;
  lastFiredAt?: string;
}

/** On-disk shape of `<root>/.tangent/triggers.json`. */
interface TriggerFile {
  triggers: StoredTrigger[];
}

/**
 * A trigger as written before delegation tokens moved to the database. The
 * token is lifted into the store on first read and the file rewritten without
 * it.
 */
type LegacyStoredTrigger = StoredTrigger & { delegationToken?: string };

/** What binds a trigger to the person it acts for, as the manager records it. */
export interface TriggerBinding {
  participantId: string;
  delegationId?: string;
  delegationToken?: string;
}

/** In-memory state for a single session's triggers. */
interface SessionTriggerState {
  rootPath: string;
  triggers: Map<string, StoredTrigger>;
}

export type TriggerListener = (
  sessionId: string,
  stored: StoredTrigger,
) => void;

/**
 * Told when a trigger leaves the store, or has its delegation superseded, so
 * whoever holds the matching external grant can let it go. `onDelegationReplaced`
 * receives the trigger as it was before the new delegation was recorded.
 */
export interface TriggerManagerHooks {
  onRemoved?: TriggerListener;
  onDelegationReplaced?: TriggerListener;
}

/** Relative path (from the session root) the compiled handler for `name` lives at. */
function compiledHandlerRel(name: string): string {
  return path.posix.join(TANGENT_DIRNAME, BUNDLE_DIRS.triggers, `${name}.js`);
}

/** Builds the public callback path for a callback-kind trigger. */
function triggerCallbackPath(
  sessionId: string,
  triggerId: string,
  secret: string,
): string {
  return `/api/sessions/${sessionId}/triggers/${triggerId}/callback/${secret}`;
}

/** Trims a maybe-undefined string to a (possibly empty) string. */
function text(value: string | undefined): string {
  return (value ?? "").trim();
}

/** A fresh callback secret. */
function newSecret(kind: TriggerKind): string | undefined {
  return kind === "callback" ? randomBytes(24).toString("hex") : undefined;
}

/**
 * Builds a trigger's target from a create request. Defaults to a dedicated
 * sub-agent (the new default); targeting Prime is opt-in. The sub-agent name
 * falls back to the trigger's title/name so a revived sub-agent stays labelled.
 */
function buildTarget(
  req: CreateTriggerRequest,
  triggerName: string,
): TriggerTarget {
  if (req.target === "prime") return { type: "prime" };
  const spec = req.subagent ?? {};
  return {
    type: "subagent",
    spec: {
      ...spec,
      name: text(spec.name) || text(req.title) || triggerName,
    },
  };
}

/**
 * Backfills a target on a trigger read from disk. Triggers persisted before
 * targets existed default to Prime so existing sessions keep their behavior.
 */
function normalizeTarget(stored: StoredTrigger): StoredTrigger {
  if (stored.target) return stored;
  return { ...stored, target: { type: "prime" } };
}

/** Normalizes a schedule, dropping it when neither field is set. */
function normalizeSchedule(
  schedule: TriggerSchedule | undefined,
): TriggerSchedule | undefined {
  if (!schedule) return undefined;
  const every = text(schedule.every) || undefined;
  const cron = text(schedule.cron) || undefined;
  if (!every && !cron) return undefined;
  return { every, cron };
}

/**
 * Projects a stored trigger onto the wire contract (hides secret/handler path).
 * Optional fields left `undefined` are dropped when serialized to JSON.
 */
function toContract(sessionId: string, t: StoredTrigger): Trigger {
  const callbackPath =
    t.kind === "callback" && t.secret
      ? triggerCallbackPath(sessionId, t.id, t.secret)
      : undefined;
  return {
    id: t.id,
    sessionId,
    name: t.name,
    kind: t.kind,
    title: t.title,
    prompt: t.prompt,
    hasHandler: Boolean(t.handlerPath),
    schedule: t.schedule,
    enabled: t.enabled,
    source: t.source,
    target: t.target,
    callbackPath,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    lastFiredAt: t.lastFiredAt,
  };
}

/** Builds a stored trigger from a bundle's declared trigger. */
function bundleToStored(
  bundleTrigger: BundleTrigger,
  now: string,
): StoredTrigger {
  return {
    id: randomUUID(),
    name: bundleTrigger.name,
    kind: bundleTrigger.kind,
    title: bundleTrigger.title,
    prompt: bundleTrigger.prompt,
    handlerPath: bundleTrigger.handler
      ? compiledHandlerRel(bundleTrigger.name)
      : undefined,
    schedule: normalizeSchedule(bundleTrigger.schedule),
    enabled: bundleTrigger.enabled ?? true,
    source: "bundle",
    // Bundle-declared triggers keep targeting Prime unless they opt in later.
    target: { type: "prime" },
    secret: newSecret(bundleTrigger.kind),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Refreshes a bundle trigger from its re-declared version. The bundle owns the
 * definition; the session keeps its id, enable toggle, target, history and (for
 * an unchanged kind) its callback secret, so existing callback URLs stay valid.
 */
function refreshBundleTrigger(
  stored: StoredTrigger,
  declared: BundleTrigger,
  now: string,
): StoredTrigger {
  const fresh = bundleToStored(declared, now);
  return {
    ...fresh,
    id: stored.id,
    enabled: stored.enabled,
    target: stored.target,
    secret: stored.kind === fresh.kind ? stored.secret : fresh.secret,
    createdAt: stored.createdAt,
    lastFiredAt: stored.lastFiredAt,
  };
}

/**
 * Refreshes or drops the stored bundle triggers against the re-declared set,
 * consuming every name it meets from `declared` so only brand-new names remain
 * there. Returns the triggers dropped.
 */
function reconcileDeclared(
  triggers: Map<string, StoredTrigger>,
  declared: Map<string, BundleTrigger>,
  now: string,
): StoredTrigger[] {
  const dropped: StoredTrigger[] = [];
  for (const [id, stored] of triggers) {
    if (stored.source !== "bundle") {
      declared.delete(stored.name);
      continue;
    }
    const next = declared.get(stored.name);
    declared.delete(stored.name);
    if (next) triggers.set(id, refreshBundleTrigger(stored, next, now));
    else {
      triggers.delete(id);
      dropped.push(stored);
    }
  }
  return dropped;
}

/** Whether recording `next` lets go of a different delegation `stored` holds. */
function dropsDelegation(
  stored: StoredTrigger,
  next: { delegationId?: string },
): boolean {
  return (
    stored.delegationId !== undefined &&
    stored.delegationId !== next.delegationId
  );
}

/** Applies a mutable patch to a stored trigger in place. */
function applyPatch(stored: StoredTrigger, patch: UpdateTriggerRequest): void {
  if (patch.enabled !== undefined) stored.enabled = patch.enabled;
  if (patch.prompt !== undefined) stored.prompt = patch.prompt.trim();
  if (patch.title !== undefined) stored.title = text(patch.title) || undefined;
  if (patch.schedule !== undefined) {
    stored.schedule = normalizeSchedule(patch.schedule);
  }
  stored.updatedAt = new Date().toISOString();
}

/**
 * Owns the per-session trigger store. Triggers persist on disk under each
 * session's `.tangent/triggers.json` so they survive a server restart even
 * though the session list itself is currently in-memory. The manager is the
 * single writer; the scheduler, callback route, and Prime tool all go through
 * it.
 */
export class TriggerManager {
  private readonly sessions = new Map<string, SessionTriggerState>();
  private readonly tokens: TriggerDelegationStore | undefined;
  private hooks: TriggerManagerHooks = {};

  /** Without a token store, delegations are recorded but never fire. */
  constructor(tokens?: TriggerDelegationStore) {
    this.tokens = tokens;
  }

  /** Installs the listeners for triggers and delegations being let go. */
  listen(hooks: TriggerManagerHooks): void {
    this.hooks = hooks;
  }

  private notify(
    hook: keyof TriggerManagerHooks,
    sessionId: string,
    stored: StoredTrigger,
  ): void {
    this.hooks[hook]?.(sessionId, stored);
  }

  /** Absolute path to a session's triggers file. */
  private triggersFile(rootPath: string): string {
    return path.join(rootPath, TANGENT_DIRNAME, TRIGGERS_FILENAME);
  }

  /**
   * Loads a session's triggers from disk into memory (idempotent). Returns the
   * in-memory state, creating it on first access. Safe to call on every
   * `pi.ensure()`.
   */
  register(sessionId: string, rootPath: string): SessionTriggerState {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const triggers = new Map<string, StoredTrigger>();
    let imported = false;
    for (const legacy of this.read(rootPath)) {
      const { delegationToken, ...stored } = legacy;
      if (delegationToken) {
        this.importLegacyToken(sessionId, stored, delegationToken);
        imported = true;
      }
      triggers.set(stored.id, stored);
    }
    const state: SessionTriggerState = { rootPath, triggers };
    this.sessions.set(sessionId, state);
    if (imported) this.persist(state);
    return state;
  }

  private importLegacyToken(
    sessionId: string,
    stored: StoredTrigger,
    token: string,
  ): void {
    if (!stored.participantId || !stored.delegationId) return;
    try {
      this.tokens?.put({
        sessionId,
        triggerId: stored.id,
        participantId: stored.participantId,
        delegationId: stored.delegationId,
        token,
      });
    } catch (err) {
      console.error(
        `[triggers] could not keep the legacy token of trigger ${stored.id} in session ${sessionId}; it is dropped:`,
        err,
      );
    }
  }

  /**
   * Forgets a deleted session's triggers, reporting each as removed. Only the
   * in-memory state goes; the disk file is left with the session's folder.
   */
  dispose(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    for (const stored of state?.triggers.values() ?? []) {
      this.forgetToken(sessionId, stored);
      this.notify("onRemoved", sessionId, stored);
    }
  }

  private forgetToken(sessionId: string, stored: StoredTrigger): void {
    if (stored.delegationId) this.tokens?.delete(sessionId, stored.id);
  }

  /** Reads and parses the triggers file, returning `[]` when absent/invalid. */
  private read(rootPath: string): LegacyStoredTrigger[] {
    const file = this.triggersFile(rootPath);
    if (!existsSync(file)) return [];
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as {
        triggers?: LegacyStoredTrigger[];
      };
      return Array.isArray(parsed.triggers)
        ? parsed.triggers.map(normalizeTarget)
        : [];
    } catch (err) {
      console.error(`[triggers] failed to read ${file}:`, err);
      return [];
    }
  }

  /** Writes a session's in-memory triggers back to disk. */
  private persist(state: SessionTriggerState): void {
    const file = this.triggersFile(state.rootPath);
    const data: TriggerFile = { triggers: [...state.triggers.values()] };
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    } catch (err) {
      console.error(`[triggers] failed to write ${file}:`, err);
    }
  }

  /** Lists a session's triggers as wire contracts. */
  list(sessionId: string): Trigger[] {
    const state = this.sessions.get(sessionId);
    if (!state) return [];
    return [...state.triggers.values()].map((t) => toContract(sessionId, t));
  }

  /** Returns a single trigger as a wire contract, if it exists. */
  get(sessionId: string, triggerId: string): Trigger | undefined {
    const stored = this.getStored(sessionId, triggerId);
    return stored ? toContract(sessionId, stored) : undefined;
  }

  /** Returns the raw stored trigger (with secret/handler), for internal use. */
  getStored(sessionId: string, triggerId: string): StoredTrigger | undefined {
    return this.sessions.get(sessionId)?.triggers.get(triggerId);
  }

  /** Lists the raw stored triggers for a session (e.g. for the scheduler). */
  listStored(sessionId: string): StoredTrigger[] {
    const state = this.sessions.get(sessionId);
    return state ? [...state.triggers.values()] : [];
  }

  /** Validates a create request, throwing a descriptive error on failure. */
  private assertCreatable(
    state: SessionTriggerState,
    name: string,
    prompt: string,
  ): void {
    if (!name) throw new Error("trigger name is required");
    if (!NAME_RE.test(name)) {
      throw new Error(
        "trigger name must be a slug matching ^[a-z0-9][a-z0-9-]*$",
      );
    }
    if ([...state.triggers.values()].some((t) => t.name === name)) {
      throw new Error(`a trigger named "${name}" already exists`);
    }
    if (!prompt) throw new Error("a runtime trigger requires a prompt");
  }

  /**
   * Creates a runtime trigger (no embedded handler — runtime triggers are
   * prompt-template only). Throws when the name collides or required fields are
   * missing.
   */
  create(
    sessionId: string,
    rootPath: string,
    req: CreateTriggerRequest,
  ): Trigger {
    const state = this.register(sessionId, rootPath);
    const name = text(req.name);
    const prompt = text(req.prompt);
    const schedule = normalizeSchedule(req.schedule);

    this.assertCreatable(state, name, prompt);
    if (req.kind === "schedule" && !schedule) {
      throw new Error(
        "schedule triggers require `schedule.every` or `schedule.cron`",
      );
    }

    const now = new Date().toISOString();
    const stored: StoredTrigger = {
      id: randomUUID(),
      name,
      kind: req.kind,
      title: text(req.title) || undefined,
      prompt,
      schedule,
      enabled: req.enabled ?? true,
      source: "runtime",
      target: buildTarget(req, name),
      secret: newSecret(req.kind),
      createdAt: now,
      updatedAt: now,
    };

    state.triggers.set(stored.id, stored);
    this.persist(state);
    return toContract(sessionId, stored);
  }

  /** Applies a mutable patch (enabled/prompt/title/schedule) to a trigger. */
  update(
    sessionId: string,
    triggerId: string,
    patch: UpdateTriggerRequest,
  ): Trigger | undefined {
    const state = this.sessions.get(sessionId);
    const stored = state?.triggers.get(triggerId);
    if (!state || !stored) return undefined;

    applyPatch(stored, patch);
    this.persist(state);
    return toContract(sessionId, stored);
  }

  /**
   * Records the currently-live sub-agent for a `subagent`-target trigger so the
   * engine can reuse it across firings and the UI can surface it. No-op for a
   * Prime-target trigger or an unknown trigger.
   */
  setTargetAgent(
    sessionId: string,
    triggerId: string,
    agentId: string,
    agentName: string,
  ): void {
    const state = this.sessions.get(sessionId);
    const stored = state?.triggers.get(triggerId);
    if (!state || !stored || stored.target.type !== "subagent") return;
    stored.target = { ...stored.target, agentId, agentName };
    stored.updatedAt = new Date().toISOString();
    this.persist(state);
  }

  /**
   * Records who a trigger acts for and, when the backend issued one, the
   * delegation it fires under. Neither reaches the wire contract, and the
   * token reaches only the delegation store, never the triggers file.
   */
  setDelegation(
    sessionId: string,
    triggerId: string,
    binding: TriggerBinding,
  ): void {
    const state = this.sessions.get(sessionId);
    const stored = state?.triggers.get(triggerId);
    if (!state || !stored) return;
    const previous = { ...stored };
    stored.participantId = binding.participantId;
    stored.delegationId = binding.delegationId;
    stored.updatedAt = new Date().toISOString();
    this.persist(state);
    this.storeToken(sessionId, stored, binding);
    if (dropsDelegation(previous, binding)) {
      this.notify("onDelegationReplaced", sessionId, previous);
    }
  }

  /**
   * Unbinds a trigger from the person it acted for, letting go of its
   * delegation. A later binding starts from nothing, so the grant it held is
   * never carried into work its holder did not ask for.
   */
  clearBinding(sessionId: string, triggerId: string): void {
    const state = this.sessions.get(sessionId);
    const stored = state?.triggers.get(triggerId);
    if (!state || !stored) return;
    const previous = { ...stored };
    stored.participantId = undefined;
    stored.delegationId = undefined;
    stored.updatedAt = new Date().toISOString();
    this.persist(state);
    this.tokens?.delete(sessionId, stored.id);
    if (previous.delegationId !== undefined) {
      this.notify("onDelegationReplaced", sessionId, previous);
    }
  }

  private storeToken(
    sessionId: string,
    stored: StoredTrigger,
    binding: TriggerBinding,
  ): void {
    if (!binding.delegationId || !binding.delegationToken) {
      this.tokens?.delete(sessionId, stored.id);
      return;
    }
    this.tokens?.put({
      sessionId,
      triggerId: stored.id,
      participantId: binding.participantId,
      delegationId: binding.delegationId,
      token: binding.delegationToken,
    });
  }

  /**
   * The grant a trigger's firing acts under: its stored token, provided it
   * still belongs to the delegation the trigger records. Undefined for a
   * trigger bound to nobody or holding no delegation.
   */
  delegationOf(
    sessionId: string,
    triggerId: string,
  ): RunDelegation | undefined {
    const stored = this.getStored(sessionId, triggerId);
    const record = this.tokens?.get(sessionId, triggerId);
    if (!stored?.participantId || !record) return undefined;
    if (record.delegationId !== stored.delegationId) return undefined;
    return {
      triggerId,
      participantId: stored.participantId,
      token: record.token,
    };
  }

  /** Records the time a trigger last fired. */
  markFired(sessionId: string, triggerId: string): void {
    const state = this.sessions.get(sessionId);
    const stored = state?.triggers.get(triggerId);
    if (!state || !stored) return;
    stored.lastFiredAt = new Date().toISOString();
    this.persist(state);
  }

  /** Deletes a trigger. Returns true when one was removed. */
  remove(sessionId: string, triggerId: string): boolean {
    const state = this.sessions.get(sessionId);
    const stored = state?.triggers.get(triggerId);
    if (!state || !stored) return false;
    state.triggers.delete(triggerId);
    this.persist(state);
    this.forgetToken(sessionId, stored);
    this.notify("onRemoved", sessionId, stored);
    return true;
  }

  /**
   * Seeds a freshly installed bundle's declared triggers into the session
   * store. Called once at session creation. Declared handlers are recorded by
   * their compiled path (compiled at install time); bundle triggers with only a
   * prompt use template delivery.
   */
  seedFromBundle(
    sessionId: string,
    rootPath: string,
    bundleTriggers: BundleTrigger[] | undefined,
  ): void {
    if (!bundleTriggers?.length) return;

    const state = this.register(sessionId, rootPath);
    const now = new Date().toISOString();
    for (const bundleTrigger of bundleTriggers) {
      const stored = bundleToStored(bundleTrigger, now);
      state.triggers.set(stored.id, stored);
    }
    this.persist(state);
  }

  /**
   * Reconciles a session's bundle triggers with a reinstalled bundle, by name:
   * re-declared ones are refreshed in place, dropped ones removed, new ones
   * added. Runtime triggers are untouched; a new bundle trigger whose name a
   * runtime trigger already holds is skipped.
   */
  reconcileBundle(
    sessionId: string,
    rootPath: string,
    bundleTriggers: BundleTrigger[] | undefined,
  ): void {
    const state = this.register(sessionId, rootPath);
    const declared = new Map(
      (bundleTriggers ?? []).map((trigger) => [trigger.name, trigger]),
    );
    const now = new Date().toISOString();
    const dropped = reconcileDeclared(state.triggers, declared, now);
    for (const trigger of declared.values()) {
      const stored = bundleToStored(trigger, now);
      state.triggers.set(stored.id, stored);
    }
    this.persist(state);
    for (const stored of dropped) {
      this.forgetToken(sessionId, stored);
      this.notify("onRemoved", sessionId, stored);
    }
  }
}
