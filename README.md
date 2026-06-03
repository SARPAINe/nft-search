# NFT Marketplace — Full-Text Search Module

Postgres FTS over an NFT catalogue, with weighted `tsvector` ranking,
`ts_headline` highlights, JSONB trait filters, trigram typo-fallback,
and a React UI.

```
┌─────────────────────────┐    ┌────────────────────────────────┐
│  React (Vite, TS, Zod)  │ ── │  Express 5 (TS, Zod, JWT)      │
│  /search   /add         │    │  /api/search (raw SQL pool)    │
└─────────────────────────┘    │  /api/nfts*  (Prisma client)   │
                               └─────────────┬──────────────────┘
                                             │
                              ┌──────────────▼───────────────┐
                              │  Postgres 15                 │
                              │  GIN(tsvector) + GIN(jsonb)  │
                              │  + pg_trgm (typo fallback)   │
                              └──────────────────────────────┘
```

## Contents

1. [Quick start](#quick-start) — Path A (Docker) or Path B (Local)
2. [pgAdmin](#pgadmin-optional)
3. [API](#api)
4. [Architecture](#architecture)
5. [Security](#security)
6. [Performance — EXPLAIN ANALYZE](#performance--explain-analyze)
7. [File map](#file-map)

---

## Quick start

Two supported ways to run the project. **Pick one and stay on it** —
they don't mix. There is no `.env` at the repo root; each app owns its
own config.

### Path A — Everything in Docker

One command brings up postgres, the backend, and the nginx-served
frontend. Sensible defaults are baked into `docker-compose.yml`, so no
env file is required.

```bash
docker compose up -d --build
# postgres  → host :5433  (container :5432)
# backend   → http://localhost:4000
# frontend  → http://localhost:5173

# Seed (run inside the backend container; 1M rows ≈ 5–10 min on a laptop)
# Pass --truncate to wipe existing rows first; omit it to append.
docker compose exec backend node dist/scripts/seed.js --count=10000 --truncate

# Tear down (keeps the data volume)
docker compose down
# Tear down AND wipe the database
docker compose down -v
```

**Overriding defaults.** Set the variables in your shell before
`docker compose up`, e.g.:

```bash
POSTGRES_PASSWORD=… JWT_SECRET=… BACKEND_HOST_PORT=4001 docker compose up -d
```

**Port 5432 already in use?** That's why the default host mapping is
`5433`. To switch back: `POSTGRES_HOST_PORT=5432 docker compose up -d`.

### Path B — Everything local

Use this when you already have Postgres on your machine and want hot
reload from `tsx watch` and Vite.

**Prerequisites**

- Postgres 15+ on `localhost:5432`, with:
  - role `nftuser` (any password)
  - database `nftmarket`, owned by `nftuser`
  - `pg_trgm` available (default in most distributions)
- Node 20+

**Steps**

```bash
# 1. Backend
cd backend
cp .env.example .env
# Edit .env: set the DB password in DATABASE_URL, and set strong
# values for JWT_SECRET (≥32 chars) and API_KEY (≥16 chars).
npm install
npx prisma generate
npm run db:migrate                       # applies 001_initial.sql
npm run seed:fresh -- --count=10000      # TRUNCATEs + seeds (use `npm run seed` to append)
npm run dev                              # http://localhost:4000

# 2. Frontend (new terminal)
cd ../frontend
cp .env.example .env                     # VITE_API_URL=http://localhost:4000
npm install
npm run dev                              # http://localhost:5173
```

No Docker required.

**Hitting the API directly** (same `/api/` prefix as Path A — there's
just no nginx in front of the backend):

```bash
# Liveness (no /api prefix — kept at root for load-balancer probes)
curl http://localhost:4000/health

# FTS search
curl "http://localhost:4000/api/search?q=ape&limit=3"

# Mint a dev JWT, then create an NFT
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/dev-token \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"address":"0x1234567890123456789012345678901234567890"}' \
  | jq -r .token)

curl -X POST http://localhost:4000/api/nfts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"token_id":"1","contract_address":"0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
       "name":"Demo","creator_address":"0x1111111111111111111111111111111111111111",
       "owner_address":"0x2222222222222222222222222222222222222222",
       "collection_name":"Demo","traits":{"rarity":"epic"},"is_listed":true}'
```

---

## pgAdmin (optional)

pgAdmin lives behind a `tools` profile in compose so it doesn't start by
default. It's a Docker-only convenience, independent of which path you
chose for the app itself.

```bash
# Start
docker compose --profile tools up -d pgadmin
# → http://localhost:5050   login: admin@example.com / admin

# Stop (keeps the container around)
docker compose --profile tools stop pgadmin
# Stop and remove the container (data volume kept either way)
docker compose --profile tools rm -sf pgadmin
```

The `--profile tools` flag is required — compose pretends the service
doesn't exist without it. Defaults can be overridden with
`PGADMIN_EMAIL=…` and `PGADMIN_PASSWORD=…` in your shell. Stick to
`.com`/`.org` TLDs; pgAdmin 8 rejects `.test`/`.local` even with
deliverability checks off.

### Registering a server

In the left tree, right-click **Servers → Register → Server…** and fill
in the table for whichever Postgres you want to manage:

| Field                | Docker Postgres            | Local Postgres (Path B)      |
| -------------------- | -------------------------- | ---------------------------- |
| Host name/address    | `postgres`                 | `host.docker.internal`       |
| Port                 | `5432` (container-internal)| `5432`                       |
| Maintenance database | `nftmarket`                | `nftmarket`                  |
| Username             | `nftuser`                  | `nftuser`                    |
| Password             | `nftpass`                  | your `backend/.env` password |
| Save password        | ✓                          | ✓                            |

Two gotchas worth knowing:

- For the **Docker** Postgres, the hostname is the compose service name
  `postgres`, **not** `localhost`. Inside the pgAdmin container,
  `localhost` is pgAdmin itself; the host-side `:5433` mapping is
  irrelevant from container-to-container.
- For the **local** Postgres, `host.docker.internal` is a magic name
  that resolves to your machine's host from inside containers. It works
  out of the box on Docker Desktop. On plain Docker Engine for Linux,
  either use the docker0 bridge IP (`172.17.0.1` typically) or add
  `extra_hosts: ["host.docker.internal:host-gateway"]` to the pgadmin
  service in `docker-compose.yml`.

### Verify

Expand the server → **Databases → nftmarket → Schemas → public → Tables
→ nfts**. Right-click `nfts` → **View/Edit Data → All Rows**.

---

## API

All app endpoints are namespaced under `/api/` so the SPA can own
client routes like `/search` and `/add` without collision. `/health`
sits at the root for liveness probes.

| Method | Path                    | Auth     | Rate limit | Notes |
| ------ | ----------------------- | -------- | ---------- | ----- |
| GET    | `/health`               | —        | —          | liveness (no `/api` prefix) |
| POST   | `/api/auth/dev-token`   | API key  | —          | mint JWT for a wallet address |
| POST   | `/api/auth/refresh`     | JWT      | —          | reissue a fresh JWT |
| GET    | `/api/auth/me`          | JWT      | —          | echo decoded JWT payload |
| GET    | `/api/search`           | —        | 60/min IP  | FTS, filters, paging, sort, highlights |
| GET    | `/api/nfts/:id`         | —        | —          | by primary key |
| POST   | `/api/nfts`             | JWT      | 10/min IP  | single create |
| PATCH  | `/api/nfts/:id`         | JWT      | —          | partial update |
| DELETE | `/api/nfts/:id`         | API key  | —          | admin |
| POST   | `/api/nfts/bulk`        | API key  | 5/min key  | up to 1000 items, 1 MB body |

### `GET /api/search` query params

```
?q=bored ape
&collection=Bored Ape Yacht Club
&min_price=0.5
&max_price=20
&listed_only=true
&trait_rarity=legendary
&trait_background=blue
&sort=relevance        # relevance | newest | price_asc | price_desc
&page=1
&limit=20              # server clamps to 50
```

Response:

```json
{
  "meta": {
    "search_mode": "fulltext | trigram_fallback | browse",
    "total": 1247832, "page": 1, "limit": 20, "total_pages": 62392,
    "query_ms": 3.1, "sort": "relevance"
  },
  "items": [{
    "id": "42", "name": "...",
    "name_highlighted": "Bored <mark>Ape</mark> #42",
    "description_snippet": "... a <mark>bored</mark> <mark>ape</mark> ...",
    "rank": 0.087, "sim_score": null,
    "price_eth": "1.25", "is_listed": true,
    "traits": { "rarity": "legendary" }
  }]
}
```

### Minting a JWT

The verifier middleware doesn't care where tokens come from; the
included `dev-token` endpoint is for development. Production typically
replaces it with SIWE (sign-a-nonce-with-your-wallet) — swap the
issuer, keep the verifier.

```bash
curl -X POST http://localhost:4000/api/auth/dev-token \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"address":"0x1234567890123456789012345678901234567890","role":"user"}'
# → { "token": "eyJ...", "token_type": "Bearer", "expires_in": 43200, ... }
```

---

## Architecture

### Hybrid ORM strategy

| Operation                        | Layer                                  | Why                                                 |
| -------------------------------- | -------------------------------------- | --------------------------------------------------- |
| `POST /api/nfts`, `PATCH`, `DELETE`  | Prisma client                              | Standard typed CRUD                                 |
| `GET /api/nfts/:id`                  | Prisma client                              | Typed PK lookup                                     |
| `POST /api/nfts/bulk`                | `prisma.nft.createMany({ skipDuplicates })` | Conflict-tolerant batch insert                     |
| **`GET /api/search`**                | **`pg` Pool + raw parameterised SQL**      | FTS needs `tsvector`/`ts_rank_cd`/`ts_headline` — Prisma can't express these |
| `scripts/seed.ts`                | `pg` + `COPY FROM STDIN`               | Orders of magnitude faster than `INSERT` for >100k rows |
| Migrations / DDL                 | Raw SQL (`001_initial.sql`)            | `GENERATED ALWAYS AS STORED` is unsupported by Prisma migrations |

**Decision rule.** Does this query need `tsvector`, `tsquery`,
`ts_rank*`, or `ts_headline`? → raw SQL. Otherwise → Prisma.

`prisma.$queryRawUnsafe()` is never used. Every raw query goes through
the `pg` pool with `$N` placeholders.

### The schema

`search_vector` is a **stored, weighted concatenation** of five text
fields. Weights A → D feed `ts_rank_cd`:

```sql
search_vector TSVECTOR GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(name, '')),               'A')  -- highest
  || setweight(to_tsvector('english', coalesce(collection_name, '')), 'B')
  || setweight(to_tsvector('english', coalesce(description, '')),     'C')
  || setweight(to_tsvector('simple',  coalesce(creator_address, '')), 'D')
  || setweight(to_tsvector('simple',  coalesce(owner_address, '')),   'D')
) STORED;
```

The `english` config stems (`jumping` → `jump`); `simple` is used for
wallet addresses where we want exact-token matches.

### Indexes

All built `CONCURRENTLY` to avoid table locks on a live DB:

- `idx_nfts_search_vector` — GIN(`search_vector`), FTS lookups
- `idx_nfts_traits`        — GIN(`traits`), `@>` containment
- `idx_nfts_collection`    — BTREE, collection filter
- `idx_nfts_listed_price`  — partial, only listed rows
- `idx_nfts_name_trgm`     — GIN(`gin_trgm_ops`), typo fallback

---

## Security

| #  | Control                | Implementation |
| -- | ---------------------- | -------------- |
| 1  | Input sanitisation     | `plainto_tsquery` (never `to_tsquery` on user input); `q` clamped to 200 chars |
| 2  | Parameterised queries  | All raw SQL via `$N`; `$queryRawUnsafe` is banned |
| 3  | Rate limiting          | `express-rate-limit`: 60/10/5 per minute (search / add / bulk) |
| 4  | Query timeout          | `SET LOCAL statement_timeout = '5s'` per request transaction |
| 5  | Hard result cap        | `Math.min(limit, 50)` server-side |
| 6  | Sort whitelist         | `SORT_MAP` translates `sort` param → SQL fragment; never interpolated |
| 7  | Security headers       | `helmet()` default suite |
| 8  | Request size           | 10 kB global, 1 MB only on `/api/nfts/bulk` |
| 9  | CORS                   | Explicit origin allowlist via `CORS_ORIGINS` |
| 10 | JWT                    | Verified per protected route; constant-time API-key compare |

### `dangerouslySetInnerHTML` — why it's safe in `NftCard.tsx`

`name_highlighted` and `description_snippet` come from Postgres
`ts_headline()`, which only inserts `<mark>` tags around existing text
in **operator-controlled DB content** — not user input. The user search
string is never piped through `innerHTML`. Do not extend this pattern
to other fields.

---

## Performance — EXPLAIN ANALYZE

After seeding, confirm the GIN index is being used:

```bash
psql "$DATABASE_URL" -c "
ANALYZE nfts;
EXPLAIN (ANALYZE, BUFFERS)
SELECT n.id, n.name, ts_rank_cd(n.search_vector, query, 32) AS rank
FROM nfts n, plainto_tsquery('english', 'bored ape') AS query
WHERE n.search_vector @@ query
ORDER BY rank DESC
LIMIT 20;"
```

**Sample output** (5,000-row dev seed):

```
 Limit  (cost=49.33..49.38 rows=20 width=44) (actual time=14.93..14.94 rows=20)
   ->  Sort  (cost=49.33..49.42 rows=39 width=44)
         Sort Key: (ts_rank_cd(n.search_vector, '''bore'' & ''ape''')) DESC
         Sort Method: top-N heapsort  Memory: 26kB
         ->  Bitmap Heap Scan on nfts n  (rows=308)
               Recheck Cond: (search_vector @@ '''bore'' & ''ape''')
               ->  Bitmap Index Scan on idx_nfts_search_vector
                     Index Cond: (search_vector @@ '''bore'' & ''ape''')
 Execution Time: 14.997 ms
```

The line that matters is **`Bitmap Index Scan on
idx_nfts_search_vector`**. If you instead see `Seq Scan on nfts`,
either the GIN index is missing or stats are stale — `ANALYZE nfts;`
and retry.

On a 1M-row seed the plan shape stays identical; execution time scales
sub-linearly because the GIN posting list is the limiting factor, not
table size.

---

## File map

```
nft-search/
├── docker-compose.yml          # full stack: postgres + backend + frontend; pgadmin via `tools` profile
├── README.md
├── .gitignore                  # ignores **/.env (each app owns its own)
├── backend/
│   ├── .env.example            # used only by Path B (local) — Docker reads compose env
│   ├── Dockerfile              # multi-stage node:20-slim → non-root runtime
│   ├── package.json            # Express 5, Prisma 7 + adapter-pg, pg, helmet, zod, faker
│   ├── tsconfig.json
│   ├── prisma.config.ts        # Prisma 7 datasource URL (moved out of schema)
│   ├── prisma/schema.prisma    # CRUD-only model; search_vector is Unsupported
│   ├── postgres/postgresql.conf
│   ├── src/
│   │   ├── app.ts              # helmet, cors, body limits, routers
│   │   ├── db/
│   │   │   ├── prisma.ts       # PrismaClient singleton
│   │   │   ├── pool.ts         # pg Pool for raw FTS
│   │   │   └── migrations/001_initial.sql   # source of truth for DDL
│   │   ├── middleware/
│   │   │   ├── auth.ts         # JWT + API key
│   │   │   ├── rateLimit.ts    # search/add/bulk
│   │   │   └── validate.ts     # Zod request validator
│   │   ├── schemas/nft.schema.ts   # Zod + SORT_MAP whitelist
│   │   └── routes/
│   │       ├── auth.ts         # JWT mint (dev-token, refresh, me)
│   │       ├── search.ts       # raw SQL FTS + trigram fallback
│   │       └── nfts.ts         # Prisma CRUD + bulk
│   └── scripts/
│       ├── migrate.ts          # idempotent migration runner (reads backend/.env)
│       ├── seed.ts             # pg-copy-streams bulk seeding
│       └── benchmark.ts        # latency sampling
└── frontend/
    ├── .env.example            # used only by Path B — Path A serves same-origin via nginx
    ├── Dockerfile              # vite build → nginx serving static + /api proxy
    ├── nginx.conf              # SPA fallback + reverse proxy to backend container
    ├── package.json            # React 18 + Vite + Zod
    ├── vite.config.ts
    ├── tsconfig.json
    ├── index.html
    └── src/
        ├── main.tsx
        ├── styles/global.css
        ├── api/search.ts       # typed client (falls back to window.location.origin under nginx)
        ├── components/
        │   ├── SearchBar.tsx   # 300 ms debounce, min-2-char gate
        │   ├── FilterSidebar.tsx
        │   ├── NftCard.tsx     # <mark> render — see security section
        │   └── Pagination.tsx
        └── pages/
            ├── SearchPage.tsx  # URL-synced filters, abortable fetch
            └── AddNftPage.tsx  # single + bulk, mirrored Zod
```
