import { useEffect, useState } from "react";
import type { SortOption } from "../api/search";

interface Props {
  initialQuery: string;
  sort: SortOption;
  onChange: (q: string) => void;
  onSortChange: (s: SortOption) => void;
}

// Debounces user keystrokes — only emits when the input has been idle
// for 300ms AND the trimmed length is >= 2 (or empty, which means browse).
export default function SearchBar({ initialQuery, sort, onChange, onSortChange }: Props) {
  const [local, setLocal] = useState(initialQuery);

  useEffect(() => { setLocal(initialQuery); }, [initialQuery]);

  useEffect(() => {
    const trimmed = local.trim();
    if (trimmed.length !== 0 && trimmed.length < 2) return;
    const t = setTimeout(() => { onChange(trimmed); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <div className="searchbar">
      <input
        type="search"
        placeholder="Search NFTs by name, collection, creator, owner..."
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        autoFocus
        aria-label="Search NFTs"
      />
      <select
        value={sort}
        onChange={(e) => onSortChange(e.target.value as SortOption)}
        aria-label="Sort order"
      >
        <option value="relevance">Relevance</option>
        <option value="newest">Newest</option>
        <option value="price_asc">Price: Low → High</option>
        <option value="price_desc">Price: High → Low</option>
      </select>
    </div>
  );
}
