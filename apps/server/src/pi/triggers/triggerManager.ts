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
  UpdateTriggerRequest,
} from "@tangent/shared/contracts.ts";

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
  /** Secret embedded in the callback URL (callback kind only). */
  secret?: string;
  createdAt: string;
  updatedAt: string;
  lastFiredAt?: string;
}

/** On-disk shape of `<root>/.tangent/triggers.json`. */
interface TriggerFile {
  triggers: StoredTrigger[];
}

/** In-memory state for a single session's triggers. */
interface SessionTriggerState {
  rootPath: string;
  triggers: Map<string, StoredTrigger>;
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
    secret: newSecret(bundleTrigger.kind),
    createdAt: now,
    updatedAt: now,
  };
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
    for (const stored of this.read(rootPath)) triggers.set(stored.id, stored);
    const state: SessionTriggerState = { rootPath, triggers };
    this.sessions.set(sessionId, state);
    return state;
  }

  /** Drops a session's in-memory state (disk file is left with the session). */
  dispose(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Reads and parses the triggers file, returning `[]` when absent/invalid. */
  private read(rootPath: string): StoredTrigger[] {
    const file = this.triggersFile(rootPath);
    if (!existsSync(file)) return [];
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as TriggerFile;
      return Array.isArray(parsed.triggers) ? parsed.triggers : [];
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
    if (!state || !state.triggers.has(triggerId)) return false;
    state.triggers.delete(triggerId);
    this.persist(state);
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
}
