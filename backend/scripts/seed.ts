/**
 * Seed script — generates realistic NFT rows and bulk-loads them via
 * Postgres COPY FROM STDIN. Far faster than per-row INSERT for >100k rows.
 *
 * Usage:
 *   npx tsx scripts/seed.ts --count=1000000 --truncate
 *   npx tsx scripts/seed.ts --count=10000
 *
 * Flags:
 *   --count=N      Number of NFTs to insert (default: 100000)
 *   --truncate     TRUNCATE TABLE nfts RESTART IDENTITY before inserting
 *   --batch=N      Batch size for COPY (default: 10000)
 */

import "dotenv/config";
import { faker } from "@faker-js/faker";
import pg from "pg";
import copyFrom from "pg-copy-streams";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

// -------- args --------
function parseArgs(argv: string[]) {
  const out: { count: number; truncate: boolean; batch: number } = {
    count: 100_000,
    truncate: false,
    batch: 10_000,
  };
  for (const a of argv.slice(2)) {
    if (a === "--truncate") out.truncate = true;
    else if (a.startsWith("--count=")) out.count = Math.max(1, Number(a.split("=")[1]));
    else if (a.startsWith("--batch=")) out.batch = Math.max(100, Number(a.split("=")[1]));
  }
  return out;
}

const args = parseArgs(process.argv);

// -------- generators --------
const COLLECTIONS = [
  "Bored Ape Yacht Club", "CryptoPunks", "Azuki", "Doodles", "Cool Cats",
  "World of Women", "Pudgy Penguins", "Moonbirds", "CloneX", "VeeFriends",
  "Mutant Ape Yacht Club", "Otherside", "Meebits", "DeGods", "Goblintown",
];

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
const BACKGROUNDS = ["blue", "red", "green", "yellow", "purple", "orange", "pink", "black", "white"];
const EYES = ["sleepy", "laser", "angry", "happy", "bored", "wink", "closed", "starry"];
const HATS = ["crown", "bandana", "beanie", "cap", "tophat", "none", "halo", "horns"];
const MOUTHS = ["smile", "frown", "open", "smirk", "tongue", "fangs", "pipe"];

function ethAddress(): string {
  return "0x" + faker.string.hexadecimal({ length: 40, casing: "lower", prefix: "" });
}

function buildTraits(): Record<string, string> {
  return {
    rarity: faker.helpers.arrayElement(RARITIES),
    background: faker.helpers.arrayElement(BACKGROUNDS),
    eyes: faker.helpers.arrayElement(EYES),
    hat: faker.helpers.arrayElement(HATS),
    mouth: faker.helpers.arrayElement(MOUTHS),
  };
}

// Escape a value for Postgres TEXT COPY format. Required escapes:
//  \  -> \\
//  \t -> \t
//  \n -> \n
//  \r -> \r
function pgCopyEscape(v: unknown): string {
  if (v === null || v === undefined) return "\\N";
  const s = typeof v === "string" ? v : String(v);
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

interface SeedRow {
  token_id: string;
  contract_address: string;
  name: string;
  description: string;
  creator_address: string;
  owner_address: string;
  collection_name: string;
  traits: string; // JSON
  price_eth: string | null;
  is_listed: "t" | "f";
}

function generateRow(index: number, contractByCollection: Map<string, string>): SeedRow {
  const collection = faker.helpers.arrayElement(COLLECTIONS);
  let contract = contractByCollection.get(collection);
  if (!contract) {
    contract = ethAddress();
    contractByCollection.set(collection, contract);
  }
  const isListed = Math.random() < 0.6;
  const price = isListed
    ? (Math.random() * 50 + 0.01).toFixed(8) // 0.01 - 50 ETH
    : null;
  const adjective = faker.word.adjective();
  const noun = faker.word.noun();
  return {
    token_id: String(index),
    contract_address: contract,
    name: `${collection.split(" ")[0]} #${index} - ${adjective} ${noun}`,
    description: `A ${adjective} ${noun} from the ${collection} collection. ${faker.lorem.sentence({ min: 8, max: 16 })}`,
    creator_address: ethAddress(),
    owner_address: ethAddress(),
    collection_name: collection,
    traits: JSON.stringify(buildTraits()),
    price_eth: price,
    is_listed: isListed ? "t" : "f",
  };
}

function rowToCopyLine(r: SeedRow): string {
  // Column order MUST match the COPY statement below.
  return [
    pgCopyEscape(r.token_id),
    pgCopyEscape(r.contract_address),
    pgCopyEscape(r.name),
    pgCopyEscape(r.description),
    pgCopyEscape(r.creator_address),
    pgCopyEscape(r.owner_address),
    pgCopyEscape(r.collection_name),
    pgCopyEscape(r.traits),
    pgCopyEscape(r.price_eth),
    pgCopyEscape(r.is_listed),
  ].join("\t") + "\n";
}

// -------- main --------
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    if (args.truncate) {
      console.log("[seed] TRUNCATE nfts RESTART IDENTITY...");
      await client.query("TRUNCATE TABLE nfts RESTART IDENTITY");
    }

    console.log(`[seed] inserting ${args.count.toLocaleString()} rows in batches of ${args.batch.toLocaleString()}...`);

    const contractByCollection = new Map<string, string>();
    const startedAt = Date.now();
    let inserted = 0;

    while (inserted < args.count) {
      const batchSize = Math.min(args.batch, args.count - inserted);

      const copySql = `
        COPY nfts (
          token_id, contract_address, name, description,
          creator_address, owner_address, collection_name,
          traits, price_eth, is_listed
        ) FROM STDIN WITH (FORMAT text, DELIMITER E'\\t', NULL '\\N')
      `;
      const ingestStream = client.query(copyFrom.from(copySql));

      // Stream the batch in line-by-line so we don't hold the whole batch in memory.
      const startIdx = inserted;
      let i = 0;
      const source = new Readable({
        read() {
          if (i >= batchSize) {
            this.push(null);
            return;
          }
          // push up to 1k rows per tick to keep backpressure healthy
          const chunkRows = Math.min(1000, batchSize - i);
          let buf = "";
          for (let k = 0; k < chunkRows; k++) {
            buf += rowToCopyLine(generateRow(startIdx + i + k + 1, contractByCollection));
          }
          i += chunkRows;
          this.push(buf);
        },
      });

      await pipeline(source, ingestStream);

      inserted += batchSize;
      const elapsedSec = (Date.now() - startedAt) / 1000;
      const rate = inserted / elapsedSec;
      const eta = (args.count - inserted) / rate;
      if (inserted % 10_000 === 0 || inserted === args.count) {
        console.log(
          `[seed] ${inserted.toLocaleString()} / ${args.count.toLocaleString()} ` +
            `(${rate.toFixed(0)} rows/s, ETA ${eta.toFixed(0)}s)`,
        );
      }
    }

    console.log(`[seed] done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

    // Refresh statistics so the planner picks the GIN index right away.
    console.log("[seed] ANALYZE nfts...");
    await client.query("ANALYZE nfts");
    console.log("[seed] ANALYZE complete");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
