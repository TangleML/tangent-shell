import type { NextFunction, Request, Response } from "express";

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
  res.status(500).json({ error: message });
}
