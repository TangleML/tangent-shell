import { randomUUID } from "node:crypto";

import type { RunId, RunIngress } from "@tangent/shared/contracts.ts";
import type { RemoteRunEvent } from "@tangent/shared/remoteSubagent.ts";

import type { RunRegistry, SettledStatus } from "../runs/runRegistry.ts";

export interface RemoteRunTarget {
  sessionId: string;
  agentId: string;
  homeConversationId: string;
}

export interface RemoteMessageOrigin {
  ingress: RunIngress;
  audienceParticipantId?: string;
}

interface SentMessage extends RemoteMessageOrigin {
  openedRunId?: RunId;
}

interface AgentRuns {
  reportsRuns: boolean;
  busy: boolean;
  sent: Map<string, SentMessage>;
}

type PromptAnswered = Extract<RemoteRunEvent, { type: "prompt-answered" }>;
type Settled = Extract<RemoteRunEvent, { type: "settled" }>;

function keyFor(sessionId: string, agentId: string): string {
  return `${sessionId}\u0000${agentId}`;
}

function settledStatus(event: Settled): SettledStatus {
  if (event.aborted) return "cancelled";
  return event.failed ? "failed" : "completed";
}

/**
 * Follows remote sub-agents' Runs the way `PiAgentManager` follows a local
 * Pi's, once a host answers a message with a disposition. A host that never
 * does keeps a Run per message, which the next one settles.
 */
export class RemoteRuns {
  private readonly runs: RunRegistry;
  private readonly agents = new Map<string, AgentRuns>();

  constructor(runs: RunRegistry) {
    this.runs = runs;
  }

  /** Returns the id to send a message under, and the Run it opened, if any. */
  send(
    target: RemoteRunTarget,
    origin: RemoteMessageOrigin,
  ): { promptId: string; runId?: RunId } {
    const agent = this.agentFor(target);
    // Until a host answers, only the latest message's answer can be the first.
    if (!agent.reportsRuns) agent.sent.clear();
    const message: SentMessage = { ...origin };
    if (!agent.reportsRuns || !agent.busy) {
      message.openedRunId = this.open(target, message);
    }
    const promptId = randomUUID();
    agent.sent.set(promptId, message);
    agent.busy = true;
    return { promptId, runId: message.openedRunId };
  }

  apply(target: RemoteRunTarget, event: RemoteRunEvent): void {
    const agent = this.agentFor(target);
    if (event.type === "prompt-answered") {
      this.onAnswered(target, agent, event);
    } else if (agent.reportsRuns) {
      // A message the agent has yet to answer may still start a run.
      agent.busy = agent.sent.size > 0;
      this.runs.settleOpenFor(
        target.sessionId,
        target.agentId,
        settledStatus(event),
      );
    }
  }

  /** A reporting host may echo a Run its message didn't end up in. */
  runIdFor(
    sessionId: string,
    agentId: string,
    echoed?: RunId,
  ): RunId | undefined {
    const agent = this.agents.get(keyFor(sessionId, agentId));
    if (echoed && !agent?.reportsRuns) return echoed;
    return this.runs.current(sessionId, agentId)?.id;
  }

  forget(sessionId: string, agentId: string): void {
    this.agents.delete(keyFor(sessionId, agentId));
  }

  private agentFor(target: RemoteRunTarget): AgentRuns {
    const key = keyFor(target.sessionId, target.agentId);
    const existing = this.agents.get(key);
    if (existing) return existing;
    const agent: AgentRuns = {
      reportsRuns: false,
      busy: false,
      sent: new Map(),
    };
    this.agents.set(key, agent);
    return agent;
  }

  private open(target: RemoteRunTarget, origin: RemoteMessageOrigin): RunId {
    return this.runs.open({
      sessionId: target.sessionId,
      participantId: target.agentId,
      homeConversationId: target.homeConversationId,
      ingress: origin.ingress,
      audienceParticipantId: origin.audienceParticipantId,
    }).id;
  }

  private onAnswered(
    target: RemoteRunTarget,
    agent: AgentRuns,
    event: PromptAnswered,
  ): void {
    if (event.disposition) agent.reportsRuns = true;
    const message = agent.sent.get(event.promptId);
    agent.sent.delete(event.promptId);
    if (message && agent.reportsRuns) {
      this.follow(target, agent, message, event);
    }
  }

  private follow(
    target: RemoteRunTarget,
    agent: AgentRuns,
    message: SentMessage,
    event: PromptAnswered,
  ): void {
    if (!event.success) {
      console.error(
        `[remote-env:${target.sessionId}:${target.agentId}] message rejected: ${event.error ?? ""}`,
      );
      this.drop(target, agent, message, "failed");
    } else if (event.disposition === "handled") {
      this.drop(target, agent, message, "completed");
    } else if (event.disposition === "started") {
      this.onStarted(target, message);
    }
  }

  /** A message sent mid-run whose run settled first starts one of its own. */
  private onStarted(target: RemoteRunTarget, message: SentMessage): void {
    const current = this.runs.current(target.sessionId, target.agentId);
    if (message.openedRunId && current?.id === message.openedRunId) return;
    this.open(target, message);
  }

  private drop(
    target: RemoteRunTarget,
    agent: AgentRuns,
    message: SentMessage,
    status: SettledStatus,
  ): void {
    const current = this.runs.current(target.sessionId, target.agentId);
    const opened = current !== undefined && current.id === message.openedRunId;
    if (current && !opened) return;
    // Freed before the Run settles, so a wake released on settle finds it idle.
    agent.busy = agent.sent.size > 0;
    if (opened) this.runs.settle(current.id, status);
  }
}
