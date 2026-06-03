/**
 * Prisma 7 configuration.
 *
 * The connection URL no longer lives in `schema.prisma` — it lives
 * here. The runtime `PrismaClient` builds an adapter from
 * `DATABASE_URL` in `src/db/prisma.ts`; this file is what the Prisma
 * CLI (`prisma migrate`, `prisma studio`, etc.) uses to know how to
 * reach the database.
 *
 * NOTE: We pass an empty string when DATABASE_URL is unset rather than
 * throwing. `prisma generate` does not need a URL and runs during the
 * Docker image build (where no env file is mounted). Commands that
 * actually need the connection (`migrate`, `studio`) will fail with a
 * clear Prisma-side error if the URL is missing at run time.
 */
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
