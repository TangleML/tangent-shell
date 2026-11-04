import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Point the session root at a throwaway dir before importing modules that read
// config at load time.
const ROOT = mkdtempSync(path.join(tmpdir(), "session-recall-"));
process.env.SESSIONS_ROOT = ROOT;

const express = (await import("express")).default;
const { mountSessionRecallRoutes } = await import("./internalSessionRecall.ts");
const { TRANSCRIPT_REFUSAL } =
  await import("../conversation/sessionTranscript.ts");
const { InMemorySessionStore } =
  await import("../store/inMemorySessionStore.ts");

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
  rmSync(ROOT, { recursive: true, force: true });
});

type Store = InstanceType<typeof InMemorySessionStore>;

/** Creates a session whose Prime conversation holds `lines`, alternating human/Prime. */
async function seedSession(
  store: Store,
  tags: string[],
  lines: string[],
): Promise<string> {
  const session = await store.createSession({ tags });
  const prime = await store.recordAgent(session.id, {
    id: "prime",
    role: "prime",
    name: "Prime",
  });
  for (const [index, content] of lines.entries()) {
    const human = index % 2 === 0;
    await store.appendMessage({
      id: `${session.id}-${index}`,
      sessionId: session.id,
      conversationId: prime.homeConversationId,
      seq: index + 1,
      author: human
        ? { id: "alice@example.com", kind: "human", name: "Alice" }
        : { id: "prime", kind: "agent", name: "Prime", agentRole: "prime" },
      mentions: [],
      source: { kind: human ? "human" : "agent" },
      content,
      createdAt: new Date().toISOString(),
    });
  }
  return session.id;
}

async function serve() {
  const store = new InMemorySessionStore();
  const router = express.Router();
  mountSessionRecallRoutes(router, store);
  const app = express();
  app.use(router);
  const server = app.listen(0);
  cleanups.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  const get = async (route: string, query: Record<string, string>) => {
    const url = new URL(`http://127.0.0.1:${port}${route}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const res = await fetch(url);
    return { status: res.status, body: (await res.json()) as never };
  };
  return { store, get };
}

const STORY = ["Tell me a bedtime story", "Once a dragon named Ember slept."];

test("a session in the same project finds and reads the story", async () => {
  const { store, get } = await serve();
  const storyId = await seedSession(store, ["projectId:A"], STORY);
  const currentId = await seedSession(store, ["projectId:A"], []);
  const storyRoot = (await store.getSession(storyId))?.rootPath ?? "";
  writeFileSync(path.join(storyRoot, "MEMORY.md"), "Told a bedtime story.");

  const related = await get("/related", { sessionId: currentId });
  assert.equal(related.status, 200);
  const sessions = (
    related.body as { sessions: { id: string; summary: string }[] }
  ).sessions;
  assert.deepEqual(
    sessions.map((s) => [s.id, s.summary]),
    [[storyId, "Told a bedtime story."]],
  );

  const search = await get("/search", {
    sessionId: currentId,
    query: "dragon",
  });
  const hits = (search.body as { hits: { sessionId: string; seq: number }[] })
    .hits;
  assert.deepEqual(
    hits.map((hit) => [hit.sessionId, hit.seq]),
    [[storyId, 2]],
  );

  const read = await get("/transcript", {
    sessionId: currentId,
    target: `[${storyId.slice(0, 8)}]`,
  });
  assert.equal(read.status, 200);
  assert.match((read.body as { text: string }).text, /dragon named Ember/);
});

test("a session in another project is refused and sees nothing", async () => {
  const { store, get } = await serve();
  const storyId = await seedSession(store, ["projectId:A"], STORY);
  const otherId = await seedSession(store, ["projectId:B"], []);

  const read = await get("/transcript", {
    sessionId: otherId,
    target: storyId,
  });
  assert.equal(read.status, 403);
  assert.deepEqual(read.body, { error: TRANSCRIPT_REFUSAL });

  const missing = await get("/transcript", {
    sessionId: otherId,
    target: "ffffffff-0000-4000-8000-000000000000",
  });
  assert.deepEqual(missing.body, read.body, "same answer as a missing session");

  const related = await get("/related", { sessionId: otherId });
  assert.deepEqual(related.body, { sessions: [] });
  const search = await get("/search", { sessionId: otherId, query: "dragon" });
  assert.deepEqual(search.body, { hits: [] });
});

test("an untagged session is refused even for an untagged sibling", async () => {
  const { store, get } = await serve();
  const siblingId = await seedSession(store, [], STORY);
  const currentId = await seedSession(store, [], []);

  const read = await get("/transcript", {
    sessionId: currentId,
    target: siblingId,
  });
  assert.equal(read.status, 403);
  const search = await get("/search", {
    sessionId: currentId,
    query: "dragon",
  });
  assert.deepEqual(search.body, { hits: [] });
});
