import { piCredential } from "../connectors/credentials.ts";
import { requireCredential } from "./requireCredential.ts";

/**
 * Guard for the `/internal/*` APIs a Pi process calls: the extensions running
 * inside each child present the token they inherited at spawn, so the Pi
 * connector's credential is the one that answers for them.
 */
export const requireInternalToken = requireCredential(piCredential);
