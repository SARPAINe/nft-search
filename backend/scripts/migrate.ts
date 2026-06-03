/**
 * Idempotent migration runner.
 *
 * Reads SQL files from src/db/migrations/ in lexical order and executes
 * them statement-by-statement. Each file's contents are wrapped in a
 * `CREATE TABLE IF NOT EXISTS …` style — the SQL itself is responsible
 * for being re-runnable. This script does not (yet) track applied
 * migrations in a table; it relies on the SQL being idempotent.
 *
 * Why a script instead of `psql -f`? Because `psql` would need the
 * DATABASE_URL exported in the shell. Going through Node lets us reuse
 * `dotenv/config` and the same `.env` the dev server reads.
 *
 * Usage:
 *   npx tsx scripts/migrate.ts
 *   npm run db:migrate
 */
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "src", "db", "migrations");

/**
 * Split a SQL file into top-level statements on semicolons that are NOT
 * inside string literals or dollar-quoted bodies (e.g. PL/pgSQL functions).
 * Tracks: single quotes, double quotes, line comments (--), block comments
 * (slash-star), and dollar-quoted strings ($tag$ ... $tag$).
 */
function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  while (i < sql.length) {
    const ch = sql[i] ?? "";
    const next = sql[i + 1] ?? "";

    if (inLineComment) {
      buf += ch;
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      buf += ch;
      if (ch === "*" && next === "/") { buf += next; i += 2; inBlockComment = false; continue; }
      i++;
      continue;
    }
    if (dollarTag) {
      buf += ch;
      if (ch === "$") {
        const slice = sql.slice(i, i + dollarTag.length);
        if (slice === dollarTag) {
          buf += sql.slice(i + 1, i + dollarTag.length);
          i += dollarTag.length;
          dollarTag = null;
          continue;
        }
      }
      i++;
      continue;
    }
    if (inSingle) {
      buf += ch;
      if (ch === "'" && next === "'") { buf += next; i += 2; continue; } // escaped quote
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      buf += ch;
      if (ch === '"') inDouble = false;
      i++;
      continue;
    }

    // Not in any quoted/commented region
    if (ch === "-" && next === "-") { buf += ch + next; i += 2; inLineComment = true; continue; }
    if (ch === "/" && next === "*") { buf += ch + next; i += 2; inBlockComment = true; continue; }
    if (ch === "'") { buf += ch; inSingle = true; i++; continue; }
    if (ch === '"') { buf += ch; inDouble = true; i++; continue; }
    if (ch === "$") {
      // dollar-quote: $tag$ where tag matches [A-Za-z0-9_]*
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        dollarTag = m[0];
        buf += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }
    if (ch === ";") {
      buf += ch;
      const stmt = buf.trim();
      if (stmt && stmt !== ";") out.push(stmt);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Did you copy backend/.env.example to backend/.env?");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    if (files.length === 0) {
      console.log("[migrate] no .sql files in", migrationsDir);
      return;
    }
    for (const file of files) {
      console.log(`[migrate] applying ${file}`);
      const sql = await readFile(join(migrationsDir, file), "utf8");
      const statements = splitSqlStatements(sql);
      for (const stmt of statements) {
        try {
          await client.query(stmt);
        } catch (err) {
          const code = (err as { code?: string }).code;
          // 42P07 = duplicate_table, 42710 = duplicate_object, 42P06 = duplicate_schema
          // 42P11 = duplicate_index? Actually duplicate_index is 42P07-ish too in some libpq versions.
          // The CREATE INDEX CONCURRENTLY IF NOT EXISTS lines short-circuit anyway.
          if (code === "42P07" || code === "42710") {
            console.log(`[migrate]   skipped (already exists): ${stmt.split("\n")[0]?.slice(0, 80)}`);
            continue;
          }
          console.error(`[migrate] FAILED: ${stmt.slice(0, 200)}…`);
          throw err;
        }
      }
      console.log(`[migrate] ${file} applied (${statements.length} statements)`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate] error:", err);
  process.exit(1);
});
