import type { Request, Response, NextFunction } from "express";
import type { ZodTypeAny, z } from "zod";

type Source = "body" | "query" | "params";

export function validate<S extends ZodTypeAny>(schema: S, source: Source = "body") {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: "validation_error",
        details: result.error.flatten(),
      });
    }
    // Stash on the request so handlers don't re-parse.
    (req as Request & { validated?: Record<Source, unknown> }).validated = {
      ...(req as Request & { validated?: Record<Source, unknown> }).validated,
      [source]: result.data,
    } as Record<Source, unknown>;
    next();
  };
}

export function getValidated<T>(req: Request, source: Source = "body"): T {
  const bag = (req as Request & { validated?: Record<Source, unknown> }).validated;
  return (bag?.[source] ?? {}) as T;
}

export type Infer<S extends ZodTypeAny> = z.infer<S>;
