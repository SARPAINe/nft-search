import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import SearchBar from "../components/SearchBar";
import FilterSidebar, { type FilterState } from "../components/FilterSidebar";
import NftCard from "../components/NftCard";
import Pagination from "../components/Pagination";
import { search, type SearchFilters, type SearchResponse, type SortOption } from "../api/search";

const SORT_VALUES: SortOption[] = ["relevance", "newest", "price_asc", "price_desc"];

// ---- URL <-> state ----
function readFromUrl(sp: URLSearchParams): SearchFilters & { filters: FilterState } {
  const traits: Record<string, string> = {};
  for (const [k, v] of sp.entries()) {
    if (k.startsWith("trait_")) traits[k.slice(6)] = v;
  }
  const sortRaw = sp.get("sort");
  const sort: SortOption = SORT_VALUES.includes(sortRaw as SortOption)
    ? (sortRaw as SortOption)
    : "relevance";

  const filters: FilterState = {
    collection: sp.get("collection") || undefined,
    min_price: sp.get("min_price") ? Number(sp.get("min_price")) : undefined,
    max_price: sp.get("max_price") ? Number(sp.get("max_price")) : undefined,
    listed_only: sp.get("listed_only") === "true",
    traits,
  };
  return {
    q: sp.get("q") ?? "",
    sort,
    page: Math.max(1, Number(sp.get("page") ?? 1)),
    limit: Math.min(50, Math.max(1, Number(sp.get("limit") ?? 20))),
    ...filters,
    filters,
  };
}

function writeToUrl(setSp: (s: URLSearchParams) => void, f: SearchFilters) {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.collection) sp.set("collection", f.collection);
  if (f.min_price !== undefined) sp.set("min_price", String(f.min_price));
  if (f.max_price !== undefined) sp.set("max_price", String(f.max_price));
  if (f.listed_only) sp.set("listed_only", "true");
  if (f.traits) {
    for (const [k, v] of Object.entries(f.traits)) {
      if (v) sp.set(`trait_${k}`, v);
    }
  }
  if (f.sort !== "relevance") sp.set("sort", f.sort);
  if (f.page !== 1) sp.set("page", String(f.page));
  if (f.limit !== 20) sp.set("limit", String(f.limit));
  setSp(sp);
}

export default function SearchPage() {
  const [sp, setSp] = useSearchParams();
  const initial = useMemo(() => readFromUrl(sp), [sp]);

  const [q, setQ] = useState(initial.q);
  const [sort, setSort] = useState<SortOption>(initial.sort);
  const [page, setPage] = useState(initial.page);
  const [filters, setFilters] = useState<FilterState>(initial.filters);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const filtersFor = useCallback(
    (): SearchFilters => ({
      q,
      sort,
      page,
      limit: 20,
      collection: filters.collection,
      min_price: filters.min_price,
      max_price: filters.max_price,
      listed_only: filters.listed_only,
      traits: filters.traits,
    }),
    [q, sort, page, filters],
  );

  // single effect drives both the network call and URL sync
  useEffect(() => {
    const f = filtersFor();
    writeToUrl((s) => setSp(s, { replace: true }), f);

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    search(f, ac.signal)
      .then((res) => { setData(res); })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setError((err as Error).message || "Search failed");
        setData(null);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => { ac.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, page, filters]);

  // reset to page 1 when query/sort/filters change (but not when page changes)
  const queryKey = JSON.stringify({ q, sort, filters });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [queryKey]);

  return (
    <div className="search-layout">
      <FilterSidebar value={filters} onChange={setFilters} />
      <section>
        <SearchBar
          initialQuery={q}
          sort={sort}
          onChange={setQ}
          onSortChange={setSort}
        />

        {data && !loading && (
          <div className="meta-line">
            Found <strong>{data.meta.total.toLocaleString()}</strong> result{data.meta.total === 1 ? "" : "s"}
            {" "}in <strong>{data.meta.query_ms.toFixed(1)}ms</strong>
            {data.meta.search_mode === "trigram_fallback" && (
              <span className="badge warn">
                No exact matches. Showing similar results for "{q}"
              </span>
            )}
            {data.meta.search_mode === "browse" && (
              <span className="badge">Browse mode</span>
            )}
          </div>
        )}

        {error && <div className="alert error">Error: {error}</div>}

        {loading ? (
          <div className="grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton skel-card" aria-hidden="true" />
            ))}
          </div>
        ) : data && data.items.length > 0 ? (
          <>
            <div className="grid">
              {data.items.map((hit) => (
                <NftCard key={hit.id} hit={hit} query={q} />
              ))}
            </div>
            <Pagination page={data.meta.page} totalPages={data.meta.total_pages} onChange={setPage} />
          </>
        ) : data ? (
          <div className="empty">
            No NFTs found{q ? ` matching "${q}"` : ""}. Try a different search or relax your filters.
          </div>
        ) : null}
      </section>
    </div>
  );
}
