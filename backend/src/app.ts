import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import searchRouter from "./routes/search.js";
import nftsRouter from "./routes/nfts.js";
import authRouter from "./routes/auth.js";

const app = express();

// Trust the first proxy so express-rate-limit + req.ip work correctly
// behind reverse proxies (nginx, cloudflare, etc.). Adjust per environment.
app.set("trust proxy", 1);

// Security headers — covers CSP, HSTS, X-Frame-Options, X-Content-Type-Options,
// Referrer-Policy, Permissions-Policy in one go.
app.use(helmet());

// CORS — explicit allowlist only. Never call cors() with no config.
const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // same-origin / curl
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("CORS: origin not allowed"));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  }),
);

// Default body limit is small; the bulk import route mounts its own larger
// parser below so that other endpoints don't accept oversized payloads.
app.use(express.json({ limit: "10kb" }));

// Liveness probe stays at the root (k8s/load-balancer convention).
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Bulk-only larger body parser. Path matches the mounted /api prefix
// so /nfts/bulk inside the router resolves to /api/nfts/bulk.
app.use("/api/nfts/bulk", express.json({ limit: "1mb" }));

// All app routes namespaced under /api so they don't collide with
// client-side SPA routes (the SPA uses /search, /add, etc.).
app.use("/api", authRouter);
app.use("/api", searchRouter);
app.use("/api", nftsRouter);

// Fallback error handler. Express 5 forwards async errors automatically.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[app] unhandled", err);
  if (res.headersSent) return;
  const message = err instanceof Error ? err.message : "internal_error";
  res.status(500).json({ error: "internal_error", message });
});

const port = Number(process.env.PORT ?? 4000);
if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    console.log(`[nft-search] listening on :${port}`);
  });
}

export default app;
