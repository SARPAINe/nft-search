import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface JwtUser {
  sub: string;
  address?: string;
  role?: "user" | "admin";
}

declare module "express-serve-static-core" {
  interface Request {
    user?: JwtUser;
  }
}

export function verifyJwt(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing_bearer_token" });
  }
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    // Fail closed — never run without a real secret.
    return res.status(500).json({ error: "server_misconfigured" });
  }
  try {
    const token = header.slice("Bearer ".length).trim();
    const payload = jwt.verify(token, secret) as JwtUser & { exp?: number };
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}

// X-API-Key gate for bulk/admin endpoints. Constant-time comparison.
export function verifyApiKey(req: Request, res: Response, next: NextFunction) {
  const provided = req.header("x-api-key") ?? "";
  const expected = process.env.API_KEY ?? "";
  if (!expected || expected.length < 16) {
    return res.status(500).json({ error: "server_misconfigured" });
  }
  if (!safeEqual(provided, expected)) {
    return res.status(401).json({ error: "invalid_api_key" });
  }
  next();
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
