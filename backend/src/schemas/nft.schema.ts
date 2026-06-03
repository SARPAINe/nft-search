import { z } from "zod";

// Ethereum address: 0x + 40 hex chars
const ethAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 40-char hex address");

// Decimal-as-string for price (handles big numbers cleanly across the wire)
const priceString = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, "price must be a positive decimal with up to 8 dp")
  .refine((s) => Number(s) >= 0, "price must be >= 0");

export const NftCreateSchema = z.object({
  token_id: z.string().min(1).max(128),
  contract_address: ethAddress,
  name: z.string().min(1).max(256),
  description: z.string().max(4_000).optional().nullable(),
  creator_address: ethAddress,
  owner_address: ethAddress,
  collection_name: z.string().min(1).max(256),
  traits: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  price_eth: priceString.optional().nullable(),
  is_listed: z.boolean().default(false),
});

export type NftCreateInput = z.infer<typeof NftCreateSchema>;

// Bulk import — array form, capped server-side.
export const NftBulkSchema = z
  .object({
    items: z.array(NftCreateSchema).min(1).max(1000),
  });

export type NftBulkInput = z.infer<typeof NftBulkSchema>;

// ------------------------------------------------------------------
// Search query — every input is validated and coerced from the query
// string. Anything that doesn't validate produces a 400 before we
// reach the database.
// ------------------------------------------------------------------
export const SORT_OPTIONS = ["relevance", "price_asc", "price_desc", "newest"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

// Whitelist used to translate sort param into a SQL fragment. Never
// interpolate user input into a query string — always look it up here.
export const SORT_MAP: Record<SortOption, string | null> = {
  relevance: null,
  price_asc: "n.price_eth ASC NULLS LAST",
  price_desc: "n.price_eth DESC NULLS LAST",
  newest: "n.created_at DESC",
};

// Trait filter from query string: trait_<key>=<value> pairs are
// folded into a JSON object before reaching this schema (see route).
const traitValue = z.union([z.string(), z.number(), z.boolean()]);

export const SearchQuerySchema = z
  .object({
    q: z.string().trim().max(200).default(""),
    collection: z.string().trim().max(256).optional(),
    min_price: z.coerce.number().nonnegative().optional(),
    max_price: z.coerce.number().nonnegative().optional(),
    listed_only: z
      .union([z.literal("true"), z.literal("false"), z.boolean()])
      .transform((v) => v === true || v === "true")
      .default(false),
    traits: z.record(z.string(), traitValue).optional(),
    sort: z.enum(SORT_OPTIONS).default("relevance"),
    page: z.coerce.number().int().positive().default(1),
    // Accept any positive integer here — the route clamps to 50 server-side
    // (Math.min). Be lenient on input, strict on what we actually execute.
    limit: z.coerce.number().int().positive().default(20),
  })
  .refine(
    (v) => v.min_price === undefined || v.max_price === undefined || v.min_price <= v.max_price,
    { message: "min_price must be <= max_price", path: ["min_price"] },
  );

export type SearchQueryInput = z.infer<typeof SearchQuerySchema>;
