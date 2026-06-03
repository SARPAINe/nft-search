import rateLimit from "express-rate-limit";

// Search — generous, but capped per IP
export const searchLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate_limited", scope: "search" },
});

// Single-NFT create — modest
export const addNftLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate_limited", scope: "add_nft" },
});

// Bulk import — keyed by API key (admin), not IP
export const bulkImportLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => (req.header("x-api-key") ?? req.ip) as string,
  message: { error: "rate_limited", scope: "bulk_import" },
});
