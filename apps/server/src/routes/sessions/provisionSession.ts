import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

import {
  type ChatAuthor,
  PI_AGENT,
  type Session,
  type SessionConfigMeta,
  type UserIdentity,
} from "@tangent/shared/contracts.ts";

import { installBundle } from "../../pi/config/bundleLoader.ts";
import type { PiAgentManager } from "../../pi/piAgentManager.ts";
import type { TriggerEngine } from "../../pi/triggers/triggerEngine.ts";
import { PRIME_AGENT_ID } from "../../pi/types.ts";
import type { AgentBundleStore } from "../../store/agentBundleStore.ts";
import type { SessionStore } from "../../store/sessionStore.ts";

interface ProvisionSessionDependencies {
  store: Pick<
    SessionStore,
    "createSession" | "attachConfig" | "appendMessage" | "deleteSession"
  >;
  pi: Pick<PiAgentManager, "ensure" | "prompt" | "dispose">;
  triggerEngine: Pick<TriggerEngine, "seed" | "dispose">;
  agentBundleStore: Pick<AgentBundleStore, "readBundle">;
}

export interface ProvisionSessionInput {
  bundleId: string;
  name?: string;
  prompt?: string;
  user?: UserIdentity;
}

export class SessionProvisioningError extends Error {
  readonly status: 400 | 404;

  constructor(message: string, status: 400 | 404) {
    super(message);
    this.status = status;
  }
}

function promptAuthor(user: UserIdentity | undefined): ChatAuthor {
  if (!user) {
    return { id: "api-user", kind: "human", name: "API" };
  }

  return {
    id: user.email,
    kind: "human",
    name: user.first_name || user.email,
  };
}

async function installSessionBundle(bundle: Buffer, rootPath: string) {
  try {
    return await installBundle(bundle, rootPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid bundle";
    throw new SessionProvisioningError(message, 400);
  }
}

async function appendMessage(
  store: Pick<SessionStore, "appendMessage">,
  sessionId: string,
  author: ChatAuthor,
  content: string,
): Promise<void> {
  await store.appendMessage({
    id: randomUUID(),
    sessionId,
    conversationId: PRIME_AGENT_ID,
    author,
    content,
    createdAt: new Date().toISOString(),
  });
}

async function configureSession(
  dependencies: ProvisionSessionDependencies,
  input: ProvisionSessionInput,
  session: Session,
  bundle: Buffer,
): Promise<Session> {
  const { store, pi, triggerEngine } = dependencies;
  const installed = await installSessionBundle(bundle, session.rootPath);
  const configMeta: SessionConfigMeta = {
    id: installed.manifest.id,
    name: installed.manifest.name,
    version: installed.manifest.version,
    icon: installed.manifest.icon,
  };
  const configuredSession = await store.attachConfig(session.id, configMeta);
  if (!configuredSession) {
    throw new Error("Unable to configure the created session");
  }

  triggerEngine.seed(session.id, session.rootPath, installed.manifest.triggers);
  if (installed.config.welcomeMessage) {
    await appendMessage(
      store,
      session.id,
      PI_AGENT,
      installed.config.welcomeMessage,
    );
  }

  pi.ensure(
    session.id,
    session.rootPath,
    installed.config,
    undefined,
    input.user,
  );
  if (input.prompt) {
    await appendMessage(
      store,
      session.id,
      promptAuthor(input.user),
      input.prompt,
    );
    pi.prompt(session.id, session.rootPath, input.prompt);
  }

  return configuredSession;
}

async function rollbackSession(
  dependencies: ProvisionSessionDependencies,
  session: Session,
): Promise<void> {
  dependencies.pi.dispose(session.id);
  dependencies.triggerEngine.dispose(session.id);
  await dependencies.store.deleteSession(session.id);
  await rm(session.rootPath, { recursive: true, force: true });
}

export async function provisionSession(
  dependencies: ProvisionSessionDependencies,
  input: ProvisionSessionInput,
): Promise<Session> {
  const bundle = await dependencies.agentBundleStore.readBundle(input.bundleId);
  if (!bundle) {
    throw new SessionProvisioningError("Agent bundle not found", 404);
  }

  const session = await dependencies.store.createSession({
    name: input.name,
    user: input.user,
  });
  try {
    return await configureSession(dependencies, input, session, bundle);
  } catch (error) {
    await rollbackSession(dependencies, session);
    throw error;
  }
}
