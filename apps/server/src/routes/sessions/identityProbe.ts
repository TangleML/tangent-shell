import type { Session } from "@tangent/shared/contracts.ts";
import type { Request } from "express";

import { resolveUserIdentity } from "../../auth/identity.ts";
import {
  CLIENT_ASSERTED,
  type IdentityAssertionCache,
  rememberAssertion,
} from "../../auth/identityAssertions.ts";
import {
  mayReadSession,
  type SessionMemberCheck,
} from "../../auth/sessionAccess.ts";

/** What admitting a session-scoped request's identity needs to consult. */
export interface IdentityProbeDeps {
  isSessionMember: SessionMemberCheck;
  assertions?: IdentityAssertionCache;
}

/**
 * Records the identity token a request carried itself, once the session it
 * names has admitted the caller: a bearer is only a claim until the server has
 * let its holder into something as that person. This is what the web client's
 * freshness probe (`GET /api/sessions/:id`) relies on in an embed deployment,
 * where the host refreshes the bearer and nothing else restamps it. Returns
 * whether the caller was admitted; a refusal records nothing.
 */
export async function recordAdmittedIdentity(
  deps: IdentityProbeDeps,
  req: Request,
  session: Session,
): Promise<boolean> {
  const email = resolveUserIdentity(req.headers)?.email;
  if (!email) return false;
  if (!(await mayReadSession(session, email, deps.isSessionMember))) {
    return false;
  }
  rememberAssertion(req.headers, CLIENT_ASSERTED, deps.assertions);
  return true;
}
