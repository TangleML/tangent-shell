import assert from "node:assert/strict";
import { test } from "node:test";

import type { BundleEditor } from "@tangent/shared/contracts.ts";
import type { Request, RequestHandler, Response } from "express";

import type { BundleEditorStore } from "../store/bundleEditorStore.ts";
import { requireAdmin, requireBundleEditor } from "./requireRole.ts";

const ADMINS: ReadonlySet<string> = new Set(["admin@example.com"]);

const EDITORS: BundleEditorStore = {
  list: async () => [] as BundleEditor[],
  has: async (email) => email === "editor@example.com",
  add: async () => {
    throw new Error("not used");
  },
  remove: async () => false,
};

/** A request carrying an unsigned bearer JWT for `email`, or no credential. */
function requestFor(email?: string): Request {
  const payload = Buffer.from(JSON.stringify({ email })).toString("base64url");
  const authorization = email
    ? `Bearer header.${payload}.signature`
    : undefined;
  return { headers: { authorization } } as unknown as Request;
}

/** Runs a guard and reports whether it passed or the status it answered. */
async function run(
  guard: RequestHandler,
  req: Request,
): Promise<"next" | number> {
  let status: number | undefined;
  let passed = false;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  await guard(req, res, () => {
    passed = true;
  });
  return passed ? "next" : (status ?? -1);
}

test("requireAdmin lets everyone through when no admins are configured", async () => {
  assert.equal(await run(requireAdmin(new Set()), requestFor()), "next");
});

test("requireAdmin answers 401 without identity and 403 for non-admins", async () => {
  const guard = requireAdmin(ADMINS);
  assert.equal(await run(guard, requestFor()), 401);
  assert.equal(await run(guard, requestFor("editor@example.com")), 403);
  assert.equal(await run(guard, requestFor("Admin@Example.com")), "next");
});

test("requireBundleEditor admits admins and listed editors only", async () => {
  const guard = requireBundleEditor(EDITORS, ADMINS);
  assert.equal(await run(guard, requestFor()), 401);
  assert.equal(await run(guard, requestFor("someone@example.com")), 403);
  assert.equal(await run(guard, requestFor("editor@example.com")), "next");
  assert.equal(await run(guard, requestFor("admin@example.com")), "next");
});

test("requireBundleEditor is open when no admins are configured", async () => {
  const guard = requireBundleEditor(EDITORS, new Set());
  assert.equal(await run(guard, requestFor("someone@example.com")), "next");
});
