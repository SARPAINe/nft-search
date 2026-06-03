import { useState } from "react";
import { z } from "zod";
import { bulkCreate, createNft, type NftCreateInput } from "../api/search";

// Mirror server-side Zod schema EXACTLY. If you change one, change the other.
const ethAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x address (40 hex chars)");

const priceString = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, "decimal with up to 8 dp")
  .refine((s) => Number(s) >= 0, "must be >= 0");

const SingleNftSchema = z.object({
  token_id: z.string().min(1).max(128),
  contract_address: ethAddress,
  name: z.string().min(1).max(256),
  description: z.string().max(4000).optional(),
  creator_address: ethAddress,
  owner_address: ethAddress,
  collection_name: z.string().min(1).max(256),
  traits_json: z
    .string()
    .optional()
    .transform((s) => (s && s.trim() ? s : "{}"))
    .pipe(
      z.string().refine((s) => { try { JSON.parse(s); return true; } catch { return false; } }, "must be valid JSON"),
    ),
  price_eth: priceString.optional(),
  is_listed: z.boolean(),
});

type FormState = z.input<typeof SingleNftSchema>;
type FieldErrors = Partial<Record<keyof FormState, string>>;

const emptyForm: FormState = {
  token_id: "",
  contract_address: "",
  name: "",
  description: "",
  creator_address: "",
  owner_address: "",
  collection_name: "",
  traits_json: "",
  price_eth: "",
  is_listed: false,
};

export default function AddNftPage() {
  // ---- single ----
  const [form, setForm] = useState<FormState>(emptyForm);
  const [jwt, setJwt] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [singleResult, setSingleResult] = useState<string | null>(null);
  const [singleError, setSingleError] = useState<string | null>(null);

  // ---- bulk ----
  const [bulkJson, setBulkJson] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submitSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    setSingleError(null);
    setSingleResult(null);
    const parsed = SingleNftSchema.safeParse(form);
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FormState | undefined;
        if (key && !fe[key]) fe[key] = issue.message;
      }
      setErrors(fe);
      return;
    }
    if (!jwt) {
      setSingleError("JWT is required to create an NFT");
      return;
    }
    const data = parsed.data;
    const traits = JSON.parse(data.traits_json) as Record<string, string | number | boolean>;
    const payload: NftCreateInput = {
      token_id: data.token_id,
      contract_address: data.contract_address,
      name: data.name,
      description: data.description || null,
      creator_address: data.creator_address,
      owner_address: data.owner_address,
      collection_name: data.collection_name,
      traits,
      price_eth: data.price_eth || null,
      is_listed: data.is_listed,
    };
    setSubmitting(true);
    try {
      const res = await createNft(payload, jwt);
      setSingleResult(JSON.stringify(res, null, 2));
      setForm(emptyForm);
    } catch (err) {
      setSingleError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitBulk = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkError(null);
    setBulkResult(null);
    if (!apiKey) {
      setBulkError("X-API-Key is required for bulk import");
      return;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(bulkJson); }
    catch { setBulkError("Body must be valid JSON"); return; }

    let items: unknown[];
    if (Array.isArray(parsed)) items = parsed;
    else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown[] }).items)) {
      items = (parsed as { items: unknown[] }).items;
    } else {
      setBulkError("Bulk JSON must be an array, or { items: [...] }");
      return;
    }
    if (items.length === 0) { setBulkError("No items provided"); return; }
    if (items.length > 1000) { setBulkError("Max 1000 items per bulk request"); return; }

    setBulkSubmitting(true);
    try {
      const result = await bulkCreate(items as NftCreateInput[], apiKey);
      setBulkResult(
        `Inserted: ${result.inserted}\nSkipped (duplicates): ${result.skipped}\nTotal sent: ${result.total}`,
      );
    } catch (err) {
      setBulkError((err as Error).message);
    } finally {
      setBulkSubmitting(false);
    }
  };

  return (
    <div className="add-layout">
      {/* ---- single create ---- */}
      <form className="card-panel" onSubmit={submitSingle}>
        <h2>Add NFT</h2>

        <div className="field">
          <label>JWT (Bearer token)</label>
          <input type="password" value={jwt} onChange={(e) => setJwt(e.target.value)} placeholder="eyJ..." />
        </div>

        <div className="row-2">
          <div className="field">
            <label>Token ID</label>
            <input value={form.token_id} onChange={(e) => setField("token_id", e.target.value)} />
            {errors.token_id && <span className="err">{errors.token_id}</span>}
          </div>
          <div className="field">
            <label>Contract Address</label>
            <input value={form.contract_address} onChange={(e) => setField("contract_address", e.target.value)} placeholder="0x…" />
            {errors.contract_address && <span className="err">{errors.contract_address}</span>}
          </div>
        </div>

        <div className="field">
          <label>Name</label>
          <input value={form.name} onChange={(e) => setField("name", e.target.value)} />
          {errors.name && <span className="err">{errors.name}</span>}
        </div>

        <div className="field">
          <label>Description</label>
          <textarea value={form.description ?? ""} onChange={(e) => setField("description", e.target.value)} />
          {errors.description && <span className="err">{errors.description}</span>}
        </div>

        <div className="row-2">
          <div className="field">
            <label>Creator Address</label>
            <input value={form.creator_address} onChange={(e) => setField("creator_address", e.target.value)} placeholder="0x…" />
            {errors.creator_address && <span className="err">{errors.creator_address}</span>}
          </div>
          <div className="field">
            <label>Owner Address</label>
            <input value={form.owner_address} onChange={(e) => setField("owner_address", e.target.value)} placeholder="0x…" />
            {errors.owner_address && <span className="err">{errors.owner_address}</span>}
          </div>
        </div>

        <div className="row-2">
          <div className="field">
            <label>Collection Name</label>
            <input value={form.collection_name} onChange={(e) => setField("collection_name", e.target.value)} />
            {errors.collection_name && <span className="err">{errors.collection_name}</span>}
          </div>
          <div className="field">
            <label>Price (ETH, optional)</label>
            <input value={form.price_eth ?? ""} onChange={(e) => setField("price_eth", e.target.value)} placeholder="0.05" />
            {errors.price_eth && <span className="err">{errors.price_eth}</span>}
          </div>
        </div>

        <div className="field">
          <label>Traits (JSON object)</label>
          <textarea
            value={form.traits_json ?? ""}
            onChange={(e) => setField("traits_json", e.target.value)}
            placeholder='{"rarity":"legendary","background":"blue"}'
          />
          {errors.traits_json && <span className="err">{errors.traits_json}</span>}
        </div>

        <div className="field">
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.is_listed}
              onChange={(e) => setField("is_listed", e.target.checked)}
            />
            {" "}Listed for sale
          </label>
        </div>

        {singleError && <div className="alert error">{singleError}</div>}
        {singleResult && (
          <div className="alert ok">
            Created successfully.
            <pre className="bulk-result" style={{ marginTop: 8 }}>{singleResult}</pre>
          </div>
        )}

        <div className="actions">
          <button type="button" className="btn-secondary" onClick={() => { setForm(emptyForm); setErrors({}); }}>Reset</button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? "Creating..." : "Create NFT"}
          </button>
        </div>
      </form>

      {/* ---- bulk import ---- */}
      <form className="card-panel" onSubmit={submitBulk}>
        <h2>Bulk Import</h2>
        <div className="field">
          <label>X-API-Key</label>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <div className="field">
          <label>JSON (array of NFTs, or {"{ items: [...] }"})</label>
          <textarea
            value={bulkJson}
            onChange={(e) => setBulkJson(e.target.value)}
            style={{ minHeight: 220, fontFamily: "ui-monospace, monospace", fontSize: 13 }}
            placeholder='[{"token_id":"1","contract_address":"0x...","name":"...","creator_address":"0x...","owner_address":"0x...","collection_name":"...","traits":{},"is_listed":false}]'
          />
        </div>

        {bulkError && <div className="alert error">{bulkError}</div>}
        {bulkResult && (
          <div className="alert ok">
            <pre className="bulk-result">{bulkResult}</pre>
          </div>
        )}

        <div className="actions">
          <button type="submit" className="btn-primary" disabled={bulkSubmitting}>
            {bulkSubmitting ? "Importing..." : "Import"}
          </button>
        </div>
      </form>
    </div>
  );
}
