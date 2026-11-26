import { existsSync, realpathSync } from "node:fs";

import {
  humanAuthor,
  type ListAgentBundlesResponse,
  type Session,
  sourceFromAuthor,
} from "@tangent/shared/contracts.ts";
import Database from "better-sqlite3";

import { SESSIONS_DB } from "./config.ts";
import { orchestratorConversationFor } from "./conversation/participantRegistry.ts";
import { openDb } from "./store/db/client.ts";
import { SqliteParticipantStore } from "./store/sqliteParticipantStore.ts";
import { SqliteSessionStore } from "./store/sqliteSessionStore.ts";

const projectsApi = "http://127.0.0.1:8000/api";
const shellApi = "http://127.0.0.1:8787/api";
const marker = "seed:collaboration";
const people = [
  {
    email: "avery.chen@example.com",
    first_name: "Avery",
    last_name: "Chen",
    presence: "connected",
    messageId: "8ed340f7-1444-4364-977a-08f0ce05ad21",
    content: "I checked the sample rows. The new labels look good to me.",
  },
  {
    email: "jamie.rivera@example.com",
    first_name: "Jamie",
    last_name: "Rivera",
    presence: "away",
    messageId: "415c2835-2858-4e88-88f6-c309c41f8fdb",
    content: "Thanks, Avery. I added two more examples for our next review.",
  },
] as const;

async function request<T = unknown>(
  url: string,
  body?: object,
  acceptedStatus?: number,
): Promise<T> {
  const response = await fetch(url, {
    redirect: "error",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok && response.status !== acceptedStatus) {
    throw new Error(
      `${body === undefined ? "GET" : "POST"} ${url} returned ${response.status}.`,
    );
  }
  return response.json() as Promise<T>;
}

interface Workspace {
  id: string;
  is_active: boolean;
  data: { tangentBaseUrl?: string } | null;
}

interface Project {
  id: string;
  data: { seed?: string } | null;
}

async function findOrCreateProject(): Promise<Project> {
  const { workspaces } = await request<{ workspaces: Workspace[] }>(
    `${projectsApi}/workspaces/`,
  );
  const workspace = workspaces.find(({ is_active, data }) => {
    const url =
      typeof data?.tangentBaseUrl === "string"
        ? data.tangentBaseUrl.trim().replace(/\/+$/, "")
        : "";
    return (
      is_active &&
      (!url ||
        url === "http://localhost:5173" ||
        url === "http://127.0.0.1:5173")
    );
  });
  if (!workspace)
    throw new Error(
      "Create an active workspace that uses local Tangent first.",
    );

  const url = new URL(`${projectsApi}/projects/`);
  url.searchParams.set("workspace_id", workspace.id);
  url.searchParams.set("page_size", "100");
  for (;;) {
    const page = await request<{
      projects: Project[];
      next_page_token: string | null;
    }>(url.href);
    const existing = page.projects.find(
      (project) => project.data?.seed === marker,
    );
    if (existing) return existing;
    if (!page.next_page_token) break;
    url.searchParams.set("page_token", page.next_page_token);
  }
  return request<Project>(`${projectsApi}/projects/`, {
    workspace_id: workspace.id,
    name: "Collaboration demo",
    data: { seed: marker },
  });
}

async function findOrCreateSession(projectId: string): Promise<Session> {
  const projectTag = `projectId:${projectId}`;
  const { sessions } = await request<{ sessions: Session[] }>(
    `${shellApi}/sessions`,
  );
  const existing = sessions.find(
    (session) =>
      session.tags.includes(marker) && session.tags.includes(projectTag),
  );
  if (existing) return existing;

  const { bundles } = await request<ListAgentBundlesResponse>(
    `${shellApi}/agent-bundles`,
  );
  const bundleId = ["tangle", "tangle-oss"].find((id) =>
    bundles.some((bundle) => bundle.id === id),
  );
  if (!bundleId)
    throw new Error(
      "Install the tangle or tangle-oss bundle in the local Shell marketplace first.",
    );
  const { session } = await request<{ session: Session }>(
    `${shellApi}/sessions`,
    {
      bundleId,
      name: "Dataset review",
      tags: [marker, projectTag],
    },
  );
  return session;
}

async function seedCollaboration(): Promise<void> {
  const project = await findOrCreateProject();
  const session = await findOrCreateSession(project.id);
  const db = openDb();
  const sessions = new SqliteSessionStore(db);
  if (!(await sessions.getSession(session.id)))
    throw new Error("Run this command in the checkout serving local Tangent.");
  const participants = new SqliteParticipantStore(db);

  const conversationId = await orchestratorConversationFor(
    sessions,
    session.id,
  );
  const messages = await sessions.getConversationMessages(
    session.id,
    conversationId,
  );
  for (const person of people) {
    await request(`${shellApi}/sessions/${session.id}/participants`, {
      email: person.email,
      displayName: `${person.first_name} ${person.last_name}`,
      conversationIds: [conversationId],
    });
    await participants.updatePresence(
      session.id,
      person.email,
      person.presence,
    );
    if (messages.some((message) => message.id === person.messageId)) continue;
    const author = humanAuthor(person);
    await sessions.appendMessage({
      id: person.messageId,
      sessionId: session.id,
      conversationId,
      seq: await sessions.nextSeq(session.id, conversationId),
      author,
      source: sourceFromAuthor(author),
      content: person.content,
      mentions: [],
      createdAt: new Date().toISOString(),
    });
  }
  // The projects API returns 409 when this session is already attached.
  await request(
    `${projectsApi}/projects/${encodeURIComponent(project.id)}/resources/`,
    {
      entity: "agent_session",
      entity_id: session.id,
      name: session.name,
    },
    409,
  );
  console.log(
    `http://localhost:3000/tangent/${encodeURIComponent(project.id)}?session=${encodeURIComponent(session.id)}`,
  );
}

async function main(): Promise<void> {
  if (!existsSync(SESSIONS_DB))
    throw new Error("Run this command in the checkout serving local Tangent.");

  // The OS releases this SQLite lock on exit, even if the seed is interrupted.
  // Keep it separate so the running Shell can still write sessions.
  const lock = new Database(
    `${realpathSync(SESSIONS_DB)}.collaboration-seed-lock`,
    {
      timeout: 0,
    },
  );
  try {
    try {
      lock.exec("BEGIN EXCLUSIVE");
    } catch (error) {
      if (error instanceof Database.SqliteError && error.code === "SQLITE_BUSY")
        throw new Error("Another collaboration seed is already in progress.", {
          cause: error,
        });
      throw error;
    }
    await seedCollaboration();
  } finally {
    lock.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    "[seed:collaboration]",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
