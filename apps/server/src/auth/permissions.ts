import type { UserPermissions } from "@tangent/shared/contracts.ts";
import type { Request } from "express";

import { ADMIN_EMAILS } from "../config.ts";
import type { BundleEditorStore } from "../store/bundleEditorStore.ts";
import { resolveUserIdentity } from "./identity.ts";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The role gate is on only once at least one admin is configured. */
export function gateEnabled(
  admins: ReadonlySet<string> = ADMIN_EMAILS,
): boolean {
  return admins.size > 0;
}

/** Whether `email` is an admin; everyone is while the gate is off. */
export function isAdmin(
  email: string | undefined,
  admins: ReadonlySet<string> = ADMIN_EMAILS,
): boolean {
  if (!gateEnabled(admins)) return true;
  if (!email) return false;
  return admins.has(normalizeEmail(email));
}

/** Whether `email` may upload and delete bundles: admins and listed editors. */
export async function canEditBundles(
  email: string | undefined,
  editors: BundleEditorStore,
  admins: ReadonlySet<string> = ADMIN_EMAILS,
): Promise<boolean> {
  if (isAdmin(email, admins)) return true;
  if (!email) return false;
  return editors.has(normalizeEmail(email));
}

export async function resolvePermissions(
  email: string | undefined,
  editors: BundleEditorStore,
  admins: ReadonlySet<string> = ADMIN_EMAILS,
): Promise<UserPermissions> {
  return {
    isAdmin: isAdmin(email, admins),
    canEditBundles: await canEditBundles(email, editors, admins),
  };
}

/** The caller's email from its bearer JWT or auth cookie, if any. */
export function requestEmail(req: Request): string | undefined {
  return resolveUserIdentity(req.headers.cookie, req.headers.authorization)
    ?.email;
}
