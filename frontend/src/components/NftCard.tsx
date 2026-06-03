import type { NftHit } from "../api/search";

interface Props {
  hit: NftHit;
  /** Current search query. Used to highlight matched substrings in addresses. */
  query?: string;
}

// name_highlighted and description_snippet are produced by Postgres
// ts_headline() over our own DB content, wrapping matched terms in
// <mark> tags. We render them with dangerouslySetInnerHTML because:
//   (a) the source data (NFT name/description) is operator-controlled
//       via our authenticated /nfts endpoints, not direct user input,
//   (b) ts_headline returns ONLY <mark> tags around existing text —
//       it does not introduce arbitrary HTML,
//   (c) we never pass user search input through innerHTML; only
//       the server's headline string. Do NOT extend this pattern to
//       any other field.

/**
 * Highlight the matched hex substring of an address inside React
 * (no innerHTML, so no escaping concerns). The query may include a
 * leading `0x` and any casing; the addresses we display are stored
 * lowercase.
 */
function highlightAddress(address: string, query?: string) {
  if (!query) return address;
  const trimmed = query.trim().toLowerCase();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (hex.length < 2 || !/^[0-9a-f]+$/.test(hex)) return address;
  const lower = address.toLowerCase();
  const idx = lower.indexOf(hex);
  if (idx === -1) return address;
  return (
    <>
      {address.slice(0, idx)}
      <mark>{address.slice(idx, idx + hex.length)}</mark>
      {address.slice(idx + hex.length)}
    </>
  );
}

interface AddressRowProps {
  label: string;
  address: string;
  query?: string;
}

function AddressRow({ label, address, query }: AddressRowProps) {
  return (
    <div className="addr-row" title={address}>
      <span className="addr-label">{label}</span>
      <span className="addr-value">{highlightAddress(address, query)}</span>
    </div>
  );
}

export default function NftCard({ hit, query }: Props) {
  const nameHtml = { __html: hit.name_highlighted };
  const snippetHtml = hit.description_snippet ? { __html: hit.description_snippet } : null;
  const price = hit.price_eth ? `${Number(hit.price_eth).toFixed(4)} ETH` : "—";

  return (
    <article className="nft-card">
      <div className="row">
        <span className="collection">{hit.collection_name}</span>
        {hit.rank !== null && (
          <span className="rank-badge" title="ts_rank_cd score">
            rank {hit.rank.toFixed(3)}
          </span>
        )}
        {hit.sim_score !== null && (
          <span className="rank-badge" title="trigram similarity">
            sim {hit.sim_score.toFixed(2)}
          </span>
        )}
      </div>

      <div className="title" dangerouslySetInnerHTML={nameHtml} />
      {snippetHtml && <div className="snippet" dangerouslySetInnerHTML={snippetHtml} />}

      <div className="addresses">
        <AddressRow label="Contract" address={hit.contract_address} query={query} />
        <AddressRow label="Creator"  address={hit.creator_address}  query={query} />
        <AddressRow label="Owner"    address={hit.owner_address}    query={query} />
      </div>

      <div className="traits">
        {Object.entries(hit.traits)
          .slice(0, 4)
          .map(([k, v]) => (
            <span key={k} className="trait">{k}: {String(v)}</span>
          ))}
      </div>

      <div className="row">
        <span className="price">{price}</span>
        <span className={hit.is_listed ? "listed" : "unlisted"}>
          {hit.is_listed ? "● Listed" : "Not listed"}
        </span>
      </div>
    </article>
  );
}
