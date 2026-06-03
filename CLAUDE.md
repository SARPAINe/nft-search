# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A full-text NFT marketplace search module: a React/Vite SPA (`frontend/`) talking to an Express 5 API (`backend/`) backed by PostgreSQL with `tsvector` FTS + `pg_trgm` typo fallback. The search experience is the whole point — most of the interesting logic lives in [backend/src/routes/search.ts](backend/src/routes/search.ts) and the SQL migration.

## Commands

Run backend commands from `backend/`, frontend from `frontend/`.

**Backend**
- `npm run dev` — tsx watch, http://localhost:4000
- `npm run build` / `npm start` — tsc to `dist/`, then `node dist/app.js`
- `npm run db:migrate` — applies `src/db/migrations/*.sql` (idempotent runner, see below)
- `npm run seed:fresh -- --count=10000` — TRUNCATE + seed; `npm run seed` appends. Flags: `--count=N`, `--truncate`, `--batch=N`
- `npm run benchmark` — latency check against a seeded DB (sanity-checks GIN index use)
- `npx prisma generate` — required after schema changes / fresh install
- `npm test` / `npm run test:watch` — vitest (note: **no test files currently exist** despite the script + supertest dev dep)

**Frontend**
- `npm run dev` — Vite, http://localhost:5173 (strictPort)
- `npm run build` — `tsc -b && vite build`

**Docker (full stack):** `docker compose up -d --build` brings up postgres (host :5433), backend (:4000), frontend (:5173). Seed inside the container with the compiled JS: `docker compose exec backend node dist/scripts/seed.js --count=10000 --truncate`. `docker compose down -v` wipes the DB volume.

## Two run modes — they read config differently

- **Path A (Docker):** config comes from `docker-compose.yml` inline `${VAR:-default}` fallbacks. It does **not** read `backend/.env`. Override by exporting shell vars before `docker compose up`.
- **Path B (local):** copy `backend/.env.example` → `backend/.env` and `frontend/.env.example` → `frontend/.env`. Requires Postgres 15+ on `localhost:5432` (role `nftuser`, db `nftmarket`, `pg_trgm` available).

Required backend env: `DATABASE_URL`, `JWT_SECRET` (≥32 chars — enforced at runtime), `API_KEY` (≥16 chars — enforced), `CORS_ORIGINS`.

## Architecture: the hybrid ORM strategy (the key design decision)

The backend deliberately uses **two** database layers. Match new code to the right one:

- **Prisma client** ([src/db/prisma.ts](backend/src/db/prisma.ts)) — all typed CRUD: `POST/PATCH/DELETE /nfts`, `GET /nfts/:id`, bulk insert. Prisma 7 with the `@prisma/adapter-pg` driver adapter.
- **Raw `pg` Pool** ([src/db/pool.ts](backend/src/db/pool.ts)) — **only** `GET /search` and the seed script. Used because FTS needs `tsvector` / `ts_rank_cd` / `ts_headline`, which Prisma cannot express.

**Decision rule:** does the query need `tsvector`, `tsquery`, `ts_rank*`, or `ts_headline`? → raw `pg` with `$N` placeholders. Otherwise → Prisma. `prisma.$queryRawUnsafe()` is banned; every raw query is parameterised.

## The search_vector column lives in SQL, not Prisma

[backend/src/db/migrations/001_initial.sql](backend/src/db/migrations/001_initial.sql) is the **source of truth** for the `nfts` table. `search_vector` is a `TSVECTOR GENERATED ALWAYS AS STORED` weighted concat of 5 fields (name=A, collection=B, description=C english-stemmed; creator/owner addresses=D `simple`). Prisma cannot model generated tsvector columns, so [prisma/schema.prisma](backend/prisma/schema.prisma) marks it `Unsupported("tsvector")?` so Prisma ignores it on writes. **If you change searchable fields, edit the SQL migration — not just the Prisma schema.**

Prisma 7 specifics: the connection URL is **not** in `schema.prisma`; it's in [prisma.config.ts](backend/prisma.config.ts) (for the CLI) and built from `DATABASE_URL` in `src/db/prisma.ts` (at runtime).

### Migrations are idempotent, not versioned

[scripts/migrate.ts](backend/scripts/migrate.ts) runs `*.sql` files in lexical order, splitting on top-level semicolons (a hand-written parser that respects dollar-quoted PL/pgSQL bodies). There is **no applied-migrations tracking table** — every statement must be re-runnable (`CREATE ... IF NOT EXISTS`, etc.). New migration files must preserve this. Indexes use `CREATE INDEX CONCURRENTLY` (can't run in a transaction), which is why Docker mounts the migrations into `docker-entrypoint-initdb.d` where each statement runs individually.

## Search request flow ([routes/search.ts](backend/src/routes/search.ts))

1. `trait_<key>=<value>` query params → folded into a nested `traits` object (capped at 10) before Zod validation.
2. Validate/coerce via `SearchQuerySchema`; `limit` re-clamped to 50 with `Math.min`.
3. One transaction with `SET LOCAL statement_timeout = '5s'`. Primary query is FTS (`plainto_tsquery`, ranked by `ts_rank_cd`, with `ts_headline` highlighting).
4. **Trigram fallback:** if FTS returns 0 rows and `q` is short, lowers `pg_trgm.word_similarity_threshold` to 0.35 (per-transaction) and retries with `word_similarity` / `<%` (substring match — chosen over plain `%`/`similarity` because catalog names are long). Response `meta.search_mode` is `fulltext` | `trigram_fallback` | `browse`.

Two non-obvious guardrails when editing search SQL:
- Sort is never interpolated from user input — `sort` maps through `SORT_MAP` (a whitelist in [schemas/nft.schema.ts](backend/src/schemas/nft.schema.ts)) to a SQL fragment.
- Always `plainto_tsquery` on user input, never `to_tsquery`.

## Auth & routing

- `verifyJwt` (Bearer, HS256) gates user writes; `verifyApiKey` (`X-API-Key`, constant-time compare) gates admin/bulk/`dev-token`. Both **fail closed** (500) if the secret is missing/too short. See [middleware/auth.ts](backend/src/middleware/auth.ts).
- All API routes are mounted under `/api` so they don't collide with the SPA's client routes (`/search`, `/add`). `/health` stays at root for load-balancer probes.
- Per-route rate limits (search 60, add 10, bulk 5 per minute) in [middleware/rateLimit.ts](backend/src/middleware/rateLimit.ts); bulk is keyed by API key, others by IP. Body limit is 10kB globally, 1MB only on `/api/nfts/bulk`.

## Frontend notes

- API base resolves in [src/api/search.ts](frontend/src/api/search.ts): `VITE_API_URL` if set (local dev), else same-origin (Docker/nginx reverse-proxy). All calls hit `${base}/api`.
- `NftCard.tsx` uses `dangerouslySetInnerHTML` **only** for `name_highlighted` / `description_snippet`, which are `ts_headline()` output wrapping operator DB content in `<mark>` — the user's search string is never piped through innerHTML. Do not extend this pattern to other fields.

## Performance sanity check

After seeding, an `EXPLAIN (ANALYZE, BUFFERS)` on a FTS query should show `Bitmap Index Scan on idx_nfts_search_vector`. If you see `Seq Scan on nfts`, run `ANALYZE nfts;` (stale stats) or check the GIN index exists. `npm run benchmark` automates a representative set.
