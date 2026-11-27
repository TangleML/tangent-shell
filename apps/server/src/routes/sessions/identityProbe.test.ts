import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const ROOT = mkdtempSync(path.join(tmpdir(), "identity-probe-"));
process.env.SESSIONS_ROOT = ROOT;
// A bearer identifies a caller only in an embed deployment; read at import.
process.env.EMBED_ALLOWED_ORIGINS = "https://host.example";

const express = (await import("express")).default;
const {
  IdentityAssertionCache,
  identityAssertions,
  rememberIdentityAssertion,
} = await import("../../auth/identityAssertions.ts");
const { createMeRouter } = await import("../me.ts");
const { InMemorySessionStore } =
  await import("../../store/inMemorySessionStore.ts");
const { InMemoryParticipantStore } =
  await import("../../store/inMemoryParticipantStore.ts");
const { handleGetSession } = await import("./handlers.ts");

import type { Request, Response } from "express";

import type { BundleEditorStore } from "../../store/bundleEditorStore.ts";

const cleanups: (() => void)[] = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
  rmSync(ROOT, { recursive: true, force: true });
});

function jwt(claims: Record<string, unknown>): string {
  const segment = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `h.${segment(claims)}.sig`;
}
const SOON = Math.floor(Date.now() / 1000) + 600;
const ALICE = jwt({ email: "alice@x", exp: SOON });
const BOB = jwt({ email: "bob@x", exp: SOON });
const OWNER = { email: "alice@x", first_name: "", last_name: "" };

/**
 * The session read and `/api/me` behind the `/api` middleware, as deployed,
 * with `members` naming who holds a Membership in which session.
 */
async function serve(members: Record<string, string[]> = {}) {
  const store = new InMemorySessionStore(new InMemoryParticipantStore());
  const assertions = new IdentityAssertionCache();
  const app = express();
  app.use("/api", rememberIdentityAssertion);
  app.get("/api/sessions/:id", (req: Request, res: Response) =>
    handleGetSession(
      {
        store,
        identityProbe: {
          isSessionMember: async (sessionId: string, email: string) =>
            (members[sessionId] ?? []).includes(email),
          assertions,
        },
      },
      req,
      req.params.id as string,
      res,
    ),
  );
  app.use("/api/me", createMeRouter({} as BundleEditorStore));
  const server = app.listen(0);
  cleanups.push(() => server.close());
  const { port } = server.address() as AddressInfo;
  const get = (route: string, token: string) =>
    fetch(`http://127.0.0.1:${port}${route}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  return { store, assertions, get };
}

test("a bearer on a session read the caller may make is recorded", async () => {
  const { store, assertions, get } = await serve();
  const open = await store.createSession({ name: "Open", user: OWNER });

  const res = await get(`/api/sessions/${open.id}`, ALICE);
  assert.equal(res.status, 200);
  assert.equal(assertions.get("alice@x")?.token, ALICE, "the owner");

  const asBob = await get(`/api/sessions/${open.id}`, BOB);
  assert.equal(asBob.status, 200);
  assert.equal(
    assertions.get("bob@x")?.token,
    BOB,
    "anyone, on an open session",
  );
});

test("on a restricted session only the owner and members have their bearer recorded", async () => {
  const members: Record<string, string[]> = {};
  const { store, assertions, get } = await serve(members);
  const restricted = await store.createSession({
    name: "Private",
    user: OWNER,
  });
  await store.updateSession(restricted.id, { accessPolicy: "restricted" });

  await get(`/api/sessions/${restricted.id}`, BOB);
  assert.equal(assertions.get("bob@x"), undefined, "neither owner nor member");

  await get(`/api/sessions/${restricted.id}`, ALICE);
  assert.equal(assertions.get("alice@x")?.token, ALICE, "the owner");

  members[restricted.id] = ["bob@x"];
  await get(`/api/sessions/${restricted.id}`, BOB);
  assert.equal(assertions.get("bob@x")?.token, BOB, "an invited member");
});

test("a bearer on /api/me, or on a session that does not exist, is not recorded", async () => {
  const { assertions, get } = await serve();

  const me = await get("/api/me", ALICE);
  assert.equal(me.status, 200);
  assert.equal(assertions.get("alice@x"), undefined);
  assert.equal(identityAssertions.get("alice@x"), undefined, "nor globally");

  const missing = await get("/api/sessions/no-such-session", ALICE);
  assert.equal(missing.status, 404);
  assert.equal(assertions.get("alice@x"), undefined);
});
