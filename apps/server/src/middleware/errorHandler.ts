import type { NextFunction, Request, Response } from "express";

/** An error carrying the HTTP status it should surface as. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A 400 to throw from a handler for host-supplied input the boundary rejects. */
export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

/**
 * Reads a usable HTTP status off a thrown value. Honours an own numeric
 * `status`/`statusCode` (body-parser sets the latter to 413 on an oversize
 * body; {@link HttpError} sets the former), falling back to 500.
 */
function statusOf(err: unknown): number {
  const record = (err ?? {}) as { status?: unknown; statusCode?: unknown };
  const candidate = record.status ?? record.statusCode;
  if (typeof candidate !== "number") return 500;
  return candidate >= 400 && candidate <= 599 ? candidate : 500;
}

/**
 * Single error-handling middleware, mounted last in `index.ts`. Express 5
 * forwards a rejected promise from an async handler here automatically, so
 * handlers can `throw` for unexpected failures and let this format one
 * consistent `{ error }` body instead of each hand-rolling a 500.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // Express identifies error middleware by its 4-arg arity, so `next` must stay
  // in the signature even though this terminates the response.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const message = err instanceof Error ? err.message : "Internal error";
  res.status(statusOf(err)).json({ error: message });
}
