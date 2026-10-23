import { ATTACH_TOKEN_HEADER } from "@tangent/shared/contracts.ts";
import {
  type Request,
  type RequestHandler,
  type Response,
  Router,
} from "express";
import type { ZodType } from "zod";

import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import {
  scopedRemoteEnvCredential,
  type ScopedTokenClaims,
  type ScopedTokenCredential,
} from "../connectors/credentials.ts";
import { subagentAuthor } from "../connectors/participantAuthor.ts";
import type { ConversationRouter } from "../conversation/conversationRouter.ts";
import type { ExternalSubagentGateway } from "../external/externalSubagentGateway.ts";
import { getValidated, validate } from "../middleware/validate.ts";
import type { ResourceGatewayDeps } from "../remote/remoteEnvironmentGateway.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import {
  type DeliveriesBody,
  deliveriesSchema,
  type EventBody,
  eventSchema,
  handleDeliveries,
  handleEvent,
  handleListResources,
  handleOpenRun,
  handlePutResource,
  handleReadResource,
  handleReport,
  handleRunEnd,
  handleStatus,
  type ListResourcesBody,
  listResourcesSchema,
  postToOrchestrator,
  type PutResourceBody,
  putResourceSchema,
  type ReadResourceBody,
  readResourceSchema,
  type RegisterBody,
  registerExternalAgent,
  registerResponse,
  registerSchema,
  type ReportBody,
  reportSchema,
  type RunBody,
  type RunEndBody,
  runEndSchema,
  runSchema,
  type StatusBody,
  statusSchema,
} from "./externalAgentHandlers.ts";

/** A request carrying the claims its session-scoped token verified to. */
interface ScopedRequest extends Request {
  scopedClaims?: ScopedTokenClaims;
}

/** An AbortSignal that fires when the request's connection closes, so a parked
 * long-poll frees its server-side waiter instead of lingering to its timeout. */
function abortOnClose(req: Request): AbortSignal {
  const controller = new AbortController();
  req.on("close", () => controller.abort());
  return controller.signal;
}

/**
 * Mounts the `/deliveries` long-poll, pinned to the token's session. An
 * attach bridge drives one agent, so the body names its `agentId` and only its
 * own directives come back; the poll's waiter is freed when the connection
 * closes rather than lingering to its timeout.
 */
function mountDeliveries(
  router: Router,
  gateway: ExternalSubagentGateway,
): void {
  router.post(
    "/deliveries",
    validate({ body: deliveriesSchema }),
    requireSessionMatch,
    (req, res) =>
      handleDeliveries(
        gateway,
        getValidated<DeliveriesBody>(req).body,
        res,
        abortOnClose(req),
      ),
  );
}

/**
 * The session-scoped token a caller presented: an `Authorization: Bearer`
 * header, or the {@link ATTACH_TOKEN_HEADER} fallback. The fallback exists
 * because an SSO proxy (Okta/Minerva) in front of the Shell can strip or
 * overwrite `Authorization` for its own auth, which would leave every attach
 * call unauthenticated; a non-standard header rides through untouched.
 */
function attachToken(req: Request): string | undefined {
  const header = req.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return req.get(ATTACH_TOKEN_HEADER);
}

/**
 * Rejects a caller without a live **session-scoped** token and stashes its
 * claims for the per-route session check. A user- or selector-scoped token is
 * refused here: attaching drives one named session, so the token must name it.
 */
function requireScopedToken(scoped: ScopedTokenCredential): RequestHandler {
  return (req, res, next) => {
    const claims = scoped.parse(attachToken(req));
    if (!claims) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!claims.sessionId) {
      res
        .status(403)
        .json({ error: "A session-scoped token is required to attach." });
      return;
    }
    (req as ScopedRequest).scopedClaims = claims;
    next();
  };
}

/**
 * Rejects a body whose session is not the token's. Runs after `validate`, so
 * the parsed `sessionId` is available; a token for one session can never drive
 * another's tabs.
 */
const requireSessionMatch: RequestHandler = (req, res, next) => {
  const claims = (req as ScopedRequest).scopedClaims;
  const { sessionId } = getValidated<{ sessionId: string }>(req).body;
  if (!claims || claims.sessionId !== sessionId) {
    res
      .status(403)
      .json({ error: "This token is not scoped to that session." });
    return;
  }
  next();
};

/**
 * Tells Prime a freshly attached agent has joined, so it can delegate. Posted
 * in the agent's own thread, addressed to the orchestrator, exactly as a
 * sub-agent's report reaches Prime. Best-effort: the tab exists either way, so a
 * failed announce must not read as a failed attach.
 */
async function announceToPrime(
  store: SessionStore,
  connectors: ConnectorRegistry,
  conversations: ConversationRouter,
  sessionId: string,
  agentId: string,
): Promise<void> {
  const author = subagentAuthor(connectors, sessionId, agentId);
  if (!author) return;
  await postToOrchestrator(
    store,
    connectors,
    conversations,
    sessionId,
    agentId,
    `${author.name} has attached to this session and is ready for tasks.`,
  );
}

/**
 * Registers the attach tab, announces it to Prime, then answers with its id.
 * Answered after the announce since the announce reads the persisted roster row
 * the register awaited; a failed announce is logged, not surfaced.
 */
async function handleAttachRegister(
  gateway: ExternalSubagentGateway,
  store: SessionStore,
  connectors: ConnectorRegistry,
  conversations: ConversationRouter,
  body: RegisterBody,
  res: Response,
): Promise<void> {
  const result = await registerExternalAgent(gateway, body);
  await announceToPrime(
    store,
    connectors,
    conversations,
    body.sessionId,
    result.id,
  ).catch((err: unknown) => {
    console.error(`[attach] announcing ${result.id} to Prime failed:`, err);
  });
  registerResponse(res, result);
}

/**
 * Public, self-service API an **attach bridge** drives to join a locally-run
 * ACP agent into a session as an `external-inbound` sub-agent. The same tab
 * machinery the internal external-agents API uses, but authorized by a
 * session-scoped remote-env token (minted at `POST /api/embed/remote-env-token`)
 * rather than the internal bearer, so a user can attach their own agent without
 * a credential only Tangent's own processes hold. Every route is pinned to the
 * token's session.
 */
export function createAttachRouter(
  gateway: ExternalSubagentGateway,
  store: SessionStore,
  connectors: ConnectorRegistry,
  conversations: ConversationRouter,
  resources: ResourceGatewayDeps,
  scoped: ScopedTokenCredential = scopedRemoteEnvCredential,
): Router {
  const router = Router();
  router.use(requireScopedToken(scoped));

  /** Mounts a gateway-backed route whose session the token must already hold. */
  const turn = <B>(
    path: string,
    schema: ZodType,
    handler: (g: ExternalSubagentGateway, body: B, res: Response) => unknown,
  ) =>
    router.post(
      path,
      validate({ body: schema }),
      requireSessionMatch,
      (req, res) => handler(gateway, getValidated<B>(req).body, res),
    );

  router.post(
    "/register",
    validate({ body: registerSchema }),
    requireSessionMatch,
    (req, res) =>
      handleAttachRegister(
        gateway,
        store,
        connectors,
        conversations,
        getValidated<RegisterBody>(req).body,
        res,
      ),
  );
  mountDeliveries(router, gateway);
  turn<RunBody>("/run", runSchema, handleOpenRun);
  turn<RunEndBody>("/run/end", runEndSchema, handleRunEnd);
  turn<EventBody>("/event", eventSchema, handleEvent);
  turn<StatusBody>("/status", statusSchema, handleStatus);
  router.post(
    "/report",
    validate({ body: reportSchema }),
    requireSessionMatch,
    (req, res) =>
      handleReport(
        store,
        connectors,
        conversations,
        getValidated<ReportBody>(req).body,
        res,
      ),
  );
  mountResourceRoutes(router, resources);

  return router;
}

/**
 * Mounts the session-resource routes an attach bridge drives on behalf of its
 * agent: `put` catalogs a contribution (attributed to the token's `sub`), `list`
 * returns the catalog, and `read` fetches one resource's bytes. Each is pinned
 * to the token's session like every other attach route.
 */
function mountResourceRoutes(
  router: Router,
  resources: ResourceGatewayDeps,
): void {
  router.post(
    "/resources/put",
    validate({ body: putResourceSchema }),
    requireSessionMatch,
    (req, res) =>
      handlePutResource(
        resources,
        (req as ScopedRequest).scopedClaims?.sub,
        getValidated<PutResourceBody>(req).body,
        res,
      ),
  );
  router.post(
    "/resources/list",
    validate({ body: listResourcesSchema }),
    requireSessionMatch,
    (req, res) =>
      handleListResources(
        resources,
        getValidated<ListResourcesBody>(req).body,
        res,
      ),
  );
  router.post(
    "/resources/read",
    validate({ body: readResourceSchema }),
    requireSessionMatch,
    (req, res) =>
      handleReadResource(getValidated<ReadResourceBody>(req).body, res),
  );
}
