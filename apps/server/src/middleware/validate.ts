import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

interface Schemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

/** The parsed, typed values produced by {@link validate}. */
export interface Validated<B = unknown, P = unknown, Q = unknown> {
  body: B;
  params: P;
  query: Q;
}

interface RequestWithValidated extends Request {
  validated?: Validated;
}

/**
 * Parses `body`/`params`/`query` against the given zod schemas, responding
 * `400` on the first failure and stashing the parsed (typed) values under a
 * single namespaced `req.validated` key — Express 5's `req.query`/`req.params`
 * are read-only getters, so we can't write back to them. Handlers read the
 * narrowed values via {@link getValidated}.
 */
export function validate(schemas: Schemas) {
  const entries = Object.entries(schemas) as [keyof Schemas, ZodType][];
  return (req: Request, res: Response, next: NextFunction): void => {
    const validated: Validated = {
      body: undefined,
      params: undefined,
      query: undefined,
    };
    for (const [key, schema] of entries) {
      const parsed = schema.safeParse(req[key]);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Invalid request", issues: parsed.error.issues });
        return;
      }
      validated[key] = parsed.data;
    }
    (req as RequestWithValidated).validated = validated;
    next();
  };
}

/**
 * Reads the values stashed by {@link validate}, typed via the caller's
 * generics so handlers stay strict-typed without casting `req.body`.
 */
export function getValidated<B = unknown, P = unknown, Q = unknown>(
  req: Request,
): Validated<B, P, Q> {
  return (req as RequestWithValidated).validated as Validated<B, P, Q>;
}
