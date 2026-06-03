/**
 * Auth — token issuance.
 *
 * Two endpoints:
 *
 *   POST /auth/dev-token   (X-API-Key gated)
 *     Mints a JWT for a given wallet address. Intended for development
 *     and server-to-server use. In production this is usually replaced
 *     by a SIWE (Sign-In With Ethereum) flow: client signs a nonce,
 *     server verifies the signature with ethers/viem and issues the JWT.
 *
 *   POST /auth/refresh     (Bearer token, not yet expired)
 *     Re-issues a JWT with a fresh expiry. Convenient for long-lived
 *     sessions in the dashboard without exposing the API key.
 *
 * Tokens are signed with JWT_SECRET (HS256). Default TTL: 12h.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { verifyApiKey, verifyJwt } from "../middleware/auth.js";
import { validate, getValidated } from "../middleware/validate.js";

const router = Router();

const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12h

const ethAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 40-char hex address");

const DevTokenSchema = z.object({
  address: ethAddress,
  role: z.enum(["user", "admin"]).default("user"),
});
type DevTokenInput = z.infer<typeof DevTokenSchema>;

function signFor(address: string, role: "user" | "admin"): { token: string; expires_in: number } {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET missing or too short (need >= 32 chars)");
  }
  const token = jwt.sign(
    { sub: address.toLowerCase(), address: address.toLowerCase(), role },
    secret,
    { algorithm: "HS256", expiresIn: TOKEN_TTL_SECONDS },
  );
  return { token, expires_in: TOKEN_TTL_SECONDS };
}

router.post(
  "/auth/dev-token",
  verifyApiKey,
  validate(DevTokenSchema, "body"),
  (req: Request, res: Response) => {
    const { address, role } = getValidated<DevTokenInput>(req, "body");
    try {
      const { token, expires_in } = signFor(address, role);
      return res.json({ token, token_type: "Bearer", expires_in, address, role });
    } catch (e) {
      return res.status(500).json({ error: "token_issue_failed", message: (e as Error).message });
    }
  },
);

router.post("/auth/refresh", verifyJwt, (req: Request, res: Response) => {
  const user = req.user;
  if (!user?.address || !user.role) {
    return res.status(401).json({ error: "invalid_token_payload" });
  }
  try {
    const { token, expires_in } = signFor(user.address, user.role);
    return res.json({ token, token_type: "Bearer", expires_in, address: user.address, role: user.role });
  } catch (e) {
    return res.status(500).json({ error: "token_refresh_failed", message: (e as Error).message });
  }
});

router.get("/auth/me", verifyJwt, (req: Request, res: Response) => {
  return res.json({ user: req.user });
});

export default router;
