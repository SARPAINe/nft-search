/**
 * Quick latency benchmark — runs a small set of representative queries
 * against the running DB and prints timings. Useful after seeding to
 * sanity-check the GIN index is being used.
 */
import "dotenv/config";
import pg from "pg";

const QUERIES: { label: string; sql: string; params: unknown[] }[] = [
  {
    label: "FTS: single word",
    sql: `SELECT count(*) FROM nfts, plainto_tsquery('english', $1) q WHERE search_vector @@ q`,
    params: ["ape"],
  },
  {
    label: "FTS: two words",
    sql: `SELECT count(*) FROM nfts, plainto_tsquery('english', $1) q WHERE search_vector @@ q`,
    params: ["bored ape"],
  },
  {
    label: "Trigram: typo",
    sql: `SELECT count(*) FROM nfts WHERE name % $1`,
    params: ["Bord Ape"],
  },
  {
    label: "Filter: listed + price range",
    sql: `SELECT count(*) FROM nfts WHERE is_listed = true AND price_eth BETWEEN $1 AND $2`,
    params: [1, 5],
  },
  {
    label: "JSONB: trait containment",
    sql: `SELECT count(*) FROM nfts WHERE traits @> $1::jsonb`,
    params: [JSON.stringify({ rarity: "legendary" })],
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const { label, sql, params } of QUERIES) {
      // warm-up
      await client.query(sql, params);
      const runs = 5;
      const samples: number[] = [];
      for (let i = 0; i < runs; i++) {
        const t = process.hrtime.bigint();
        await client.query(sql, params);
        samples.push(Number(process.hrtime.bigint() - t) / 1e6);
      }
      samples.sort((a, b) => a - b);
      const median = samples[Math.floor(samples.length / 2)] ?? 0;
      const min = samples[0] ?? 0;
      const max = samples[samples.length - 1] ?? 0;
      console.log(`${label.padEnd(36)} median=${median.toFixed(2)}ms  min=${min.toFixed(2)}  max=${max.toFixed(2)}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
