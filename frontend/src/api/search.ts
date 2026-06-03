// API base URL resolution:
//   - If VITE_API_URL is set (local dev with `npm run dev`), use it as-is.
//   - Otherwise (docker build, served behind nginx), call same-origin
//     so /api/* hits the reverse-proxy and avoids CORS.
const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");

// All endpoints are namespaced under /api so the SPA can own client
// routes like /search and /add without colliding with the backend.
const API = `${API_BASE}/api`;

export type SortOption = "relevance" | "price_asc" | "price_desc" | "newest";

export interface SearchFilters {
  q: string;
  collection?: string;
  min_price?: number;
  max_price?: number;
  listed_only?: boolean;
  traits?: Record<string, string>;
  sort: SortOption;
  page: number;
  limit: number;
}

export interface NftHit {
  id: string;
  token_id: string;
  contract_address: string;
  name: string;
  collection_name: string;
  creator_address: string;
  owner_address: string;
  traits: Record<string, unknown>;
  price_eth: string | null;
  is_listed: boolean;
  created_at: string;
  rank: number | null;
  sim_score: number | null;
  name_highlighted: string;
  description_snippet: string | null;
}

export interface SearchResponse {
  meta: {
    search_mode: "fulltext" | "trigram_fallback" | "browse";
    total: number;
    page: number;
    limit: number;
    total_pages: number;
    query_ms: number;
    sort: SortOption;
  };
  items: NftHit[];
}

export function buildSearchUrl(f: SearchFilters): string {
  // Use absolute URL so query params can be set cleanly. The `/api`
  // is already in API_BASE — concatenate the path explicitly because
  // `new URL("/search", API)` would strip the base path.
  const u = new URL(`${API}/search`);
  if (f.q) u.searchParams.set("q", f.q);
  if (f.collection) u.searchParams.set("collection", f.collection);
  if (f.min_price !== undefined) u.searchParams.set("min_price", String(f.min_price));
  if (f.max_price !== undefined) u.searchParams.set("max_price", String(f.max_price));
  if (f.listed_only) u.searchParams.set("listed_only", "true");
  if (f.traits) {
    for (const [k, v] of Object.entries(f.traits)) {
      if (v !== "" && v !== undefined && v !== null) {
        u.searchParams.set(`trait_${k}`, String(v));
      }
    }
  }
  u.searchParams.set("sort", f.sort);
  u.searchParams.set("page", String(f.page));
  u.searchParams.set("limit", String(f.limit));
  return u.toString();
}

export async function search(f: SearchFilters, signal?: AbortSignal): Promise<SearchResponse> {
  const res = await fetch(buildSearchUrl(f), { signal });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return (await res.json()) as SearchResponse;
}

// ---- writes ----

export interface NftCreateInput {
  token_id: string;
  contract_address: string;
  name: string;
  description?: string | null;
  creator_address: string;
  owner_address: string;
  collection_name: string;
  traits: Record<string, string | number | boolean>;
  price_eth?: string | null;
  is_listed: boolean;
}

export async function createNft(input: NftCreateInput, jwt: string): Promise<unknown> {
  const res = await fetch(`${API}/nfts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body;
}

export interface BulkResult {
  inserted: number;
  skipped: number;
  total: number;
}

export async function bulkCreate(items: NftCreateInput[], apiKey: string): Promise<BulkResult> {
  const res = await fetch(`${API}/nfts/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({ items }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as BulkResult;
}
