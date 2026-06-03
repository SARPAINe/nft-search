import { useEffect, useState } from "react";

export interface FilterState {
  collection?: string;
  min_price?: number;
  max_price?: number;
  listed_only: boolean;
  traits: Record<string, string>;
}

interface Props {
  value: FilterState;
  onChange: (next: FilterState) => void;
}

const COMMON_COLLECTIONS = [
  "", "Bored Ape Yacht Club", "CryptoPunks", "Azuki", "Doodles", "Cool Cats",
  "World of Women", "Pudgy Penguins", "Moonbirds", "CloneX",
];

const TRAIT_KEYS = ["rarity", "background", "eyes", "hat", "mouth"];

export default function FilterSidebar({ value, onChange }: Props) {
  const [local, setLocal] = useState<FilterState>(value);

  // sync inbound (e.g. when URL changes)
  useEffect(() => { setLocal(value); }, [value]);

  // debounce outbound so dragging price ranges doesn't fire 30 requests
  useEffect(() => {
    const t = setTimeout(() => { onChange(local); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  const setTrait = (k: string, v: string) => {
    const next = { ...local.traits };
    if (v) next[k] = v;
    else delete next[k];
    setLocal({ ...local, traits: next });
  };

  return (
    <aside className="filter-sidebar">
      <h3>Filters</h3>

      <div className="group">
        <label>Collection</label>
        <select
          value={local.collection ?? ""}
          onChange={(e) => setLocal({ ...local, collection: e.target.value || undefined })}
        >
          {COMMON_COLLECTIONS.map((c) => (
            <option key={c} value={c}>{c || "All collections"}</option>
          ))}
        </select>
      </div>

      <div className="group">
        <label>Price (ETH)</label>
        <div className="range">
          <input
            type="number" min={0} step="0.01" placeholder="min"
            value={local.min_price ?? ""}
            onChange={(e) => setLocal({ ...local, min_price: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
          <input
            type="number" min={0} step="0.01" placeholder="max"
            value={local.max_price ?? ""}
            onChange={(e) => setLocal({ ...local, max_price: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="group">
        <label className="toggle">
          <input
            type="checkbox"
            checked={local.listed_only}
            onChange={(e) => setLocal({ ...local, listed_only: e.target.checked })}
          />
          Listed only
        </label>
      </div>

      <h3 style={{ marginTop: 18 }}>Traits</h3>
      {TRAIT_KEYS.map((k) => (
        <div className="group" key={k}>
          <label>{k}</label>
          <input
            type="text"
            placeholder={`e.g. ${k === "rarity" ? "legendary" : "..."}`}
            value={local.traits[k] ?? ""}
            onChange={(e) => setTrait(k, e.target.value.trim())}
          />
        </div>
      ))}
    </aside>
  );
}
