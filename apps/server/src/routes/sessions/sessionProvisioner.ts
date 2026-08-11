import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

import type {
  ChatAuthor,
  Session,
  SessionConfigMeta,
  UserIdentity,
} from "@tangent/shared/contracts.ts";
import { PI_AGENT } from "@tangent/shared/contracts.ts";

import { installBundle } from "../../pi/config/bundleLoader.ts";
import type { PiAgentManager } from "../../pi/piAgentManager.ts";
import { PRIME_AGENT_ID } from "../../pi/piAgentManager.ts";
import type { TriggerEngine } from "../../pi/triggers/triggerEngine.ts";
import type { AgentBundleStore } from "../../store/agentBundleStore.ts";
import type { SessionStore } from "../../store/sessionStore.ts";

export class AgentBundleNotFoundError extends Error {}
export class InvalidAgentBundleError extends Error {}

export interface ProvisionSessionInput {
  bundleId: string;
  name?: string;
  prompt?: string;
  user?: UserIdentity;
}

export interface SessionProvisioner {
  create(input: ProvisionSessionInput): Promise<Session>;
}

type ProvisioningStore = Pick<
  SessionStore,
  "createSession" | "attachConfig" | "appendMessage" | "deleteSession"
>;
type ProvisioningAgentManager = Pick<
  PiAgentManager,
  "ensure" | "prompt" | "dispose"
>;
type ProvisioningTriggerEngine = Pick<TriggerEngine, "seed" | "dispose">;
type ProvisioningBundleStore = Pick<AgentBundleStore, "readBundle">;

type BundleInstallResult = Awaited<ReturnType<typeof installBundle>>;
type BundleInstaller = (
  zipBuffer: Buffer,
  rootPath: string,
) => Promise<BundleInstallResult>;

function humanAuthor(user: UserIdentity | undefined): ChatAuthor {
  if (!user) {
    return {
      id: "external-user",
      kind: "human",
      name: "External request",
    };
  }
  return {
    id: user.email,
    kind: "human",
    name: user.first_name || user.email,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Creates and fully provisions bundle-backed sessions for every entry point. */
export class DefaultSessionProvisioner implements SessionProvisioner {
  private readonly store: ProvisioningStore;
  private readonly pi: ProvisioningAgentManager;
  private readonly triggerEngine: ProvisioningTriggerEngine;
  private readonly agentBundleStore: ProvisioningBundleStore;
  private readonly installer: BundleInstaller;

  constructor(
    store: ProvisioningStore,
    pi: ProvisioningAgentManager,
    triggerEngine: ProvisioningTriggerEngine,
    agentBundleStore: ProvisioningBundleStore,
    installer: BundleInstaller = installBundle,
  ) {
    this.store = store;
    this.pi = pi;
    this.triggerEngine = triggerEngine;
    this.agentBundleStore = agentBundleStore;
    this.installer = installer;
  }

  async create(input: ProvisionSessionInput): Promise<Session> {
    const zipBuffer = await this.agentBundleStore.readBundle(input.bundleId);
    if (!zipBuffer)
      throw new AgentBundleNotFoundError("Agent bundle not found");

    const session = await this.store.createSession({
      name: input.name,
      user: input.user,
    });

    try {
      const { manifest, config } = await this.install(
        zipBuffer,
        session.rootPath,
      );
      const meta: SessionConfigMeta = {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        icon: manifest.icon,
      };
      const configured = await this.store.attachConfig(session.id, meta);
      if (!configured) throw new Error("Created session disappeared");

      this.triggerEngine.seed(session.id, session.rootPath, manifest.triggers);
      await this.appendWelcomeMessage(session.id, config.welcomeMessage);

      this.pi.ensure(
        session.id,
        session.rootPath,
        config,
        undefined,
        input.user,
      );
      await this.deliverPrompt(configured, input.prompt, input.user);
      return configured;
    } catch (error) {
      await this.rollback(session);
      throw error;
    }
  }

  private async install(zipBuffer: Buffer, rootPath: string) {
    try {
      return await this.installer(zipBuffer, rootPath);
    } catch (error) {
      throw new InvalidAgentBundleError(errorMessage(error));
    }
  }

  private async appendWelcomeMessage(
    sessionId: string,
    welcomeMessage: string | undefined,
  ): Promise<void> {
    if (!welcomeMessage) return;
    await this.store.appendMessage({
      id: randomUUID(),
      sessionId,
      conversationId: PRIME_AGENT_ID,
      author: PI_AGENT,
      content: welcomeMessage,
      createdAt: new Date().toISOString(),
    });
  }

  private async deliverPrompt(
    session: Session,
    prompt: string | undefined,
    user: UserIdentity | undefined,
  ): Promise<void> {
    if (!prompt) return;
    await this.store.appendMessage({
      id: randomUUID(),
      sessionId: session.id,
      conversationId: PRIME_AGENT_ID,
      author: humanAuthor(user),
      content: prompt,
      createdAt: new Date().toISOString(),
    });
    this.pi.prompt(session.id, session.rootPath, prompt);
  }

  private async rollback(session: Session): Promise<void> {
    this.pi.dispose(session.id);
    this.triggerEngine.dispose(session.id);
    await this.store.deleteSession(session.id);
    await rm(session.rootPath, { recursive: true, force: true });
  }
}
