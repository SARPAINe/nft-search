import { Router } from "express";
import type { Request, Response } from "express";
import { pool } from "../db/pool.js";
import { SearchQuerySchema, SORT_MAP, type SearchQueryInput } from "../schemas/nft.schema.js";
import { searchLimiter } from "../middleware/rateLimit.js";

const router = Router();

// Translate flat query-string params like ?trait_rarity=legendary into a
// nested traits object. Cap to 10 traits to bound the JSONB payload.
function extractTraitsFromQuery(q: Request["query"]): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(q)) {
    if (!key.startsWith("trait_")) continue;
    if (count >= 10) break;
    const traitKey = key.slice("trait_".length);
    if (!traitKey || typeof value !== "string") continue;
    // Try boolean/number coercion, fall back to string.
    if (value === "true") out[traitKey] = true;
    else if (value === "false") out[traitKey] = false;
    else if (/^-?\d+(\.\d+)?$/.test(value)) out[traitKey] = Number(value);
    else out[traitKey] = value;
    count++;
  }
  return Object.keys(out).length ? out : undefined;
}

// Main FTS query. NOTE: $9 is interpolated as a SQL fragment from SORT_MAP
// (a server-side whitelist), never from user input.
function buildSearchSql(secondarySort: string | null): string {
  const secondary = secondarySort ?? "n.created_at DESC";
  return `
    SELECT
      n.id::text         AS id,
      n.token_id,
      n.contract_address,
      n.name,
      n.collection_name,
      n.creator_address,
      n.owner_address,
      n.traits,
      n.price_eth::text  AS price_eth,
      n.is_listed,
      n.created_at,
      CASE WHEN $1 = '' THEN NULL
           ELSE ts_rank_cd(n.search_vector, query, 32)
      END AS rank,
      ts_headline(
        'english',
        n.name,
        query,
        'StartSel=<mark>, StopSel=</mark>, HighlightAll=true'
      ) AS name_highlighted,
      ts_headline(
        'english',
        coalesce(n.description, ''),
        query,
        'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MinWords=10, MaxWords=25, FragmentDelimiter=" ... "'
      ) AS description_snippet,
      COUNT(*) OVER() AS total_count
    FROM nfts n,
         plainto_tsquery('english', $1) AS query
    WHERE
      ($1 = '' OR n.search_vector @@ query)
      AND ($2::text    IS NULL OR n.collection_name = $2)
      AND ($3::numeric IS NULL OR n.price_eth >= $3)
      AND ($4::numeric IS NULL OR n.price_eth <= $4)
      AND ($5::boolean IS FALSE OR n.is_listed = true)
      AND ($6::jsonb   IS NULL OR n.traits @> $6)
    ORDER BY
      CASE WHEN $1 != '' THEN ts_rank_cd(n.search_vector, query, 32) END DESC NULLS LAST,
      ${secondary}
    LIMIT $7 OFFSET $8
  `;
}

// Trigram fallback. Uses `word_similarity` / `<%` (NOT `similarity` / `%`):
// our NFT names are long ("Bored #984 - tight order"), so plain similarity
// against a short query gets diluted below threshold. word_similarity
// compares the query against the closest-fitting *substring* of the name,
// which is what users actually mean by typo tolerance.
const TRIGRAM_SQL = `
  SELECT
    n.id::text         AS id,
    n.token_id,
    n.contract_address,
    n.name,
    n.collection_name,
    n.creator_address,
    n.owner_address,
    n.traits,
    n.price_eth::text  AS price_eth,
    n.is_listed,
    n.created_at,
    word_similarity($1, n.name) AS sim_score,
    COUNT(*) OVER()              AS total_count
  FROM nfts n
  WHERE $1 <% n.name
  ORDER BY word_similarity($1, n.name) DESC
  LIMIT $2 OFFSET $3
`;

router.get("/search", searchLimiter, async (req: Request, res: Response) => {
  // Fold trait_* params into a nested object before validation.
  const traits = extractTraitsFromQuery(req.query);
  const parsed = SearchQuerySchema.safeParse({ ...req.query, traits });
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
  }
  const input: SearchQueryInput = parsed.data;

  // Hard cap — clamp again in case schema is loosened later.
  const safeLimit = Math.min(input.limit, 50);
  const offset = (input.page - 1) * safeLimit;
  const secondarySort = SORT_MAP[input.sort];
  const traitFilter = input.traits ? JSON.stringify(input.traits) : null;

  const params: unknown[] = [
    input.q,
    input.collection ?? null,
    input.min_price ?? null,
    input.max_price ?? null,
    input.listed_only,
    traitFilter,
    safeLimit,
    offset,
  ];

  const started = process.hrtime.bigint();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // statement_timeout is per-transaction here; protects the pool from
    // a runaway query (bad plan, index miss, etc.).
    await client.query("SET LOCAL statement_timeout = '5s'");

    const sql = buildSearchSql(secondarySort);
    const main = await client.query(sql, params);

    let mode: "fulltext" | "trigram_fallback" | "browse" = input.q === "" ? "browse" : "fulltext";
    let rows = main.rows;
    let total = rows.length > 0 ? Number(rows[0].total_count) : 0;

    // Trigram typo-tolerance fallback: only when q is short and FTS returned nothing.
    if (rows.length === 0 && input.q !== "" && input.q.length < 40) {
      // Default word_similarity_threshold (0.6) is too strict for real-world
      // typos against catalog names. Loosen per-transaction; LOCAL keeps it
      // scoped so we don't affect other queries from this pool connection.
      await client.query("SET LOCAL pg_trgm.word_similarity_threshold = 0.35");
      const trig = await client.query(TRIGRAM_SQL, [input.q, safeLimit, offset]);
      if (trig.rows.length > 0) {
        rows = trig.rows;
        total = Number(rows[0].total_count);
        mode = "trigram_fallback";
      }
    }

    await client.query("COMMIT");

    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    const items = rows.map((r) => ({
      id: r.id,
      token_id: r.token_id,
      contract_address: r.contract_address,
      name: r.name,
      collection_name: r.collection_name,
      creator_address: r.creator_address,
      owner_address: r.owner_address,
      traits: r.traits,
      price_eth: r.price_eth,
      is_listed: r.is_listed,
      created_at: r.created_at,
      rank: r.rank ?? null,
      sim_score: r.sim_score ?? null,
      name_highlighted: r.name_highlighted ?? r.name,
      description_snippet: r.description_snippet ?? null,
    }));

    return res.json({
      meta: {
        search_mode: mode,
        total,
        page: input.page,
        limit: safeLimit,
        total_pages: Math.max(1, Math.ceil(total / safeLimit)),
        query_ms: Number(elapsedMs.toFixed(2)),
        sort: input.sort,
      },
      items,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    const code = (err as { code?: string }).code;
    if (code === "57014") {
      // statement_timeout
      return res.status(503).json({ error: "search_timeout" });
    }
    console.error("[search] query failed", err);
    return res.status(500).json({ error: "search_failed" });
  } finally {
    client.release();
  }
});

export default router;
