import type {
  OutstandingCorrelation,
  Resource,
  TerminationCause,
  WorkflowMembership,
  WorkflowReactor,
  WorkflowRoom,
  WorkflowRun,
  WorkflowView,
  WorkflowWave,
} from "@tangent/shared/contracts.ts";

import type { RunRegistry } from "../runs/runRegistry.ts";
import type { Membership, MembershipStore } from "../store/membershipStore.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import type { AdmissionEngine } from "./admission.ts";
import { ContextEngine, policyFor, policyViewFor } from "./context.ts";
import type { CorrelationEngine } from "./correlation.ts";
import { MAX_WAVE_DEPTH } from "./fanOut.ts";
import type { MembershipRegistry } from "./membershipRegistry.ts";
import type { ReactorRegistry, ReactorView } from "./reactorRegistry.ts";

/** Lists the live reaction chains in a session — the {@link ConversationRouter}
 * surface, taken structurally so the fold can be tested without a socket server. */
export interface WaveReader {
  listWaves(sessionId: string): { participantId: string; depth: number }[];
}

/** Everything {@link workflowView} folds. Each is an already-in-process read the
 * engines keep for their own reasons; this assembles them into one view. */
export interface WorkflowViewDeps {
  store: Pick<
    SessionStore,
    "getSession" | "getMessages" | "getConversationMessages"
  >;
  memberships: MembershipRegistry;
  membershipStore: Pick<MembershipStore, "listForSession">;
  reactors: ReactorRegistry;
  runs: RunRegistry;
  admission: Pick<AdmissionEngine, "depthFor">;
  waves: WaveReader;
  correlations: Pick<CorrelationEngine, "listForSession">;
  context: ContextEngine;
}

/** What the view is asked for: a whole Session, one Conversation within it, or
 * one Participant's read of one Conversation (which adds the projected room). */
export interface WorkflowViewRequest {
  sessionId: string;
  conversationId?: string;
  participantId?: string;
}

function toWorkflowMembership(membership: Membership): WorkflowMembership {
  return {
    conversationId: membership.conversationId,
    participantId: membership.participantId,
    reaction: membership.reaction,
    ingress: membership.ingress,
    admission: membership.admission,
    policy: policyViewFor(membership.transcriptVisibility),
  };
}

async function collectMemberships(
  deps: WorkflowViewDeps,
  request: WorkflowViewRequest,
): Promise<WorkflowMembership[]> {
  const rows = request.conversationId
    ? await deps.memberships.membersOf(
        request.sessionId,
        request.conversationId,
      )
    : await deps.membershipStore.listForSession(request.sessionId);
  return rows.map(toWorkflowMembership);
}

/** Whether a reactor watches or lands in a Conversation, so a conversation-scoped
 * view keeps the reactors that concern it. */
function reactorTouches(reactor: ReactorView, conversationId: string): boolean {
  if (reactor.homeConversationId === conversationId) return true;
  return reactor.scope.memberships.some(
    (member) => member.conversationId === conversationId,
  );
}

async function collectReactors(
  deps: WorkflowViewDeps,
  request: WorkflowViewRequest,
): Promise<WorkflowReactor[]> {
  const all = await deps.reactors.inspectAll(request.sessionId);
  const conversationId = request.conversationId;
  const scoped = conversationId
    ? all.filter((reactor) => reactorTouches(reactor, conversationId))
    : all;
  return scoped.map((reactor) => ({
    id: reactor.id,
    participantId: reactor.participantId,
    homeConversationId: reactor.homeConversationId,
    spec: reactor.spec,
    scope: reactor.scope,
    state: reactor.state,
    ready: reactor.ready,
  }));
}

function collectRuns(
  deps: WorkflowViewDeps,
  request: WorkflowViewRequest,
): WorkflowRun[] {
  const open = deps.runs.listForSession(request.sessionId);
  const scoped = request.conversationId
    ? open.filter((run) => run.homeConversationId === request.conversationId)
    : open;
  return scoped.map((run) => ({
    id: run.id,
    participantId: run.participantId,
    homeConversationId: run.homeConversationId,
    ingress: run.ingress,
    externalId: run.externalId,
    admissionQueueDepth: deps.admission.depthFor(
      request.sessionId,
      run.participantId,
    ),
  }));
}

/** Waves are per-participant chains, not per-Conversation, so they stay
 * session-wide even when a Conversation is named. */
function collectWaves(
  deps: WorkflowViewDeps,
  request: WorkflowViewRequest,
): WorkflowWave[] {
  return deps.waves.listWaves(request.sessionId).map((wave) => ({
    participantId: wave.participantId,
    depth: wave.depth,
    budget: MAX_WAVE_DEPTH,
  }));
}

function collectCorrelations(
  deps: WorkflowViewDeps,
  request: WorkflowViewRequest,
): OutstandingCorrelation[] {
  const all = deps.correlations.listForSession(request.sessionId);
  if (!request.conversationId) return all;
  return all.filter(
    (correlation) => correlation.conversationId === request.conversationId,
  );
}

async function collectDigests(
  deps: WorkflowViewDeps,
  request: WorkflowViewRequest,
  memberships: WorkflowMembership[],
): Promise<Resource[]> {
  if (request.conversationId) {
    return deps.context.coverage(request.sessionId, request.conversationId);
  }
  const conversationIds = new Set(memberships.map((m) => m.conversationId));
  const byId = new Map<string, Resource>();
  for (const conversationId of conversationIds) {
    const digests = await deps.context.coverage(
      request.sessionId,
      conversationId,
    );
    for (const digest of digests) byId.set(digest.id, digest);
  }
  return [...byId.values()];
}

async function collectCauses(
  deps: WorkflowViewDeps,
  request: WorkflowViewRequest,
): Promise<TerminationCause[]> {
  const messages = request.conversationId
    ? await deps.store.getConversationMessages(
        request.sessionId,
        request.conversationId,
      )
    : await deps.store.getMessages(request.sessionId);
  return messages.flatMap((message) => (message.cause ? [message.cause] : []));
}

/**
 * One Participant's projected read of a Conversation, resolved through its
 * Membership's visibility — `opaque` when it holds none, so a non-member never
 * leaks the log (the 3.5 `projectRoom` rule). Includes the `omitted` ranges the
 * projection already computes, which no agent-facing read consumes yet.
 */
async function collectRoom(
  deps: WorkflowViewDeps,
  request: WorkflowViewRequest,
): Promise<WorkflowRoom | undefined> {
  const { sessionId, conversationId, participantId } = request;
  if (!conversationId || !participantId) return undefined;
  const membership = await deps.memberships.memberIn(
    sessionId,
    conversationId,
    participantId,
  );
  const policy = policyFor(membership?.transcriptVisibility ?? "opaque");
  const messages = await deps.store.getConversationMessages(
    sessionId,
    conversationId,
  );
  const projection = await deps.context.project({
    sessionId,
    conversationId,
    participantId,
    messages,
    policy,
  });
  return {
    messages: projection.messages,
    digests: projection.digests,
    omitted: projection.omitted,
  };
}

/**
 * Folds the workflow state of a Conversation (or a whole Session, when none is
 * named) out of state the engines already keep: the membership roster with each
 * context policy, each Reactor's `S` and readiness, open Runs with admission
 * queue depth, live waves against budget, outstanding correlations, digest
 * coverage, and the causes sitting in the log (unified-model §9.8). Costs
 * nothing beyond the reads because §9.2 made the state a fold and §9.3 put it in
 * the engine.
 */
export async function workflowView(
  deps: WorkflowViewDeps,
  request: WorkflowViewRequest,
): Promise<WorkflowView> {
  const memberships = await collectMemberships(deps, request);
  const reactors = await collectReactors(deps, request);
  const digests = await collectDigests(deps, request, memberships);
  const causes = await collectCauses(deps, request);
  const room = await collectRoom(deps, request);

  const view: WorkflowView = {
    memberships,
    reactors,
    runs: collectRuns(deps, request),
    waves: collectWaves(deps, request),
    correlations: collectCorrelations(deps, request),
    digests,
    causes,
  };
  if (room) view.room = room;
  return view;
}
