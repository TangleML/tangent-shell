import type {
  CreateSessionRequest,
  ListAgentBundlesResponse,
  Session,
} from "@tangent/shared/contracts.ts";

import type { WorkerConfig } from "./config.ts";
import { type FetchFor, requestJson } from "./http.ts";
import { type OpenedSession, openProjectSession } from "./project.ts";

// The bundle the Tangle UI starts its project sessions from.
const PROJECT_BUNDLE_ID = "tangle";

async function openShellSession(
  shellUrl: string,
  config: WorkerConfig,
  shell: typeof fetch,
): Promise<Session> {
  const { sessionId, title, bundleId } = config;
  if (sessionId) {
    const id = encodeURIComponent(sessionId);
    const found = await requestJson<{ session: Session }>(
      shell,
      `${shellUrl}/api/sessions/${id}`,
    );
    return found.session;
  }
  if (!bundleId) {
    const { bundles } = await requestJson<ListAgentBundlesResponse>(
      shell,
      `${shellUrl}/api/agent-bundles`,
    );
    const ids = bundles.map((bundle) => bundle.id).join(", ");
    throw new Error(`--new needs --bundle. Available: ${ids}`);
  }
  const body: CreateSessionRequest = { name: title ?? "", bundleId };
  const created = await requestJson<{ session: Session }>(
    shell,
    `${shellUrl}/api/sessions`,
    body,
  );
  return created.session;
}

/** Joins a session, or creates one on a Shell or in a Tangle project. */
export async function openSession(
  config: WorkerConfig,
  fetchFor: FetchFor,
): Promise<OpenedSession> {
  const { project, shellUrl, title, bundleId } = config;
  if (project) {
    const bundle = bundleId ?? PROJECT_BUNDLE_ID;
    return openProjectSession(project, title ?? "", bundle, fetchFor);
  }
  if (!shellUrl) throw new Error("No Tangent Shell URL.");
  const session = await openShellSession(shellUrl, config, fetchFor(shellUrl));
  return { session, shellUrl };
}
