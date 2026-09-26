"use client";
import { useEffect, useState } from "react";
import { api, Brand } from "@/lib/api";

const empty: Brand = { id: "", name: "", category: "", tagline: "", target_contexts: [], negative_contexts: [], negative_description: "", creative: { bg: "#334155", fg: "#f8fafc" } };

export default function Brands() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [b, setB] = useState<Brand>(empty);
  const [msg, setMsg] = useState("");
  useEffect(() => { api.brands().then((c) => setBrands(c.brands)); api.vocab().then((v) => setTags(v.tags)); }, []);

  const toggle = (k: "target_contexts" | "negative_contexts", t: string) =>
    setB({ ...b, [k]: b[k].includes(t) ? b[k].filter((x) => x !== t) : [...b[k], t] });

  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    try {
      const id = b.id || b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const c = await api.addBrand({ ...b, id });
      setBrands(c.brands); setB(empty); setMsg(`Saved "${b.name}". Open any job and click "Re-run placement" to see it matched — no code changes.`);
    } catch (e) { setMsg(String(e)); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div>
        <h1 className="text-xl font-bold mb-1">Synthetic brand catalogue</h1>
        <p className="muted text-sm mb-4">All brands are fictional. <b>negative_contexts</b> are a hard block: a brand is never placed next to a scene carrying any of those tags. <b>target_contexts</b> drive affinity.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {brands.map((x) => (
            <div key={x.id} className="panel p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded font-semibold" style={{ background: x.creative?.bg, color: x.creative?.fg }}>{x.name}</span>
                <span className="muted text-xs">{x.category}</span>
                <button className="ml-auto text-xs muted hover:text-white" onClick={() => api.deleteBrand(x.id).then((c) => setBrands(c.brands))}>remove</button>
              </div>
              <div className="muted text-xs mt-1">{x.tagline}</div>
              <div className="mt-2 flex flex-wrap gap-1">{x.target_contexts.map((t) => <span key={t} className="chip chip-ok">{t}</span>)}</div>
              <div className="mt-1 flex flex-wrap gap-1">{x.negative_contexts.map((t) => <span key={t} className="chip chip-bad">{t}</span>)}</div>
              {x.negative_description && <div className="text-xs muted mt-1 italic">{x.negative_description}</div>}
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={save} className="panel p-4 flex flex-col gap-2 h-fit text-sm">
        <h2 className="font-semibold">Add a brand (the &quot;9th brand&quot; test)</h2>
        <input placeholder="Name" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} required />
        <input placeholder="Category" value={b.category} onChange={(e) => setB({ ...b, category: e.target.value })} />
        <input placeholder="Tagline" value={b.tagline} onChange={(e) => setB({ ...b, tagline: e.target.value })} />
        <div className="text-xs muted mt-1">Target contexts</div>
        <div className="flex flex-wrap gap-1">{tags.map((t) => <button type="button" key={t} onClick={() => toggle("target_contexts", t)} className={`chip ${b.target_contexts.includes(t) ? "chip-ok" : ""}`}>{t}</button>)}</div>
        <div className="text-xs muted mt-1">Negative contexts (hard block)</div>
        <div className="flex flex-wrap gap-1">{tags.map((t) => <button type="button" key={t} onClick={() => toggle("negative_contexts", t)} className={`chip ${b.negative_contexts.includes(t) ? "chip-bad" : ""}`}>{t}</button>)}</div>
        <textarea placeholder="Extra free-text rule the LLM gate enforces (optional)" value={b.negative_description} onChange={(e) => setB({ ...b, negative_description: e.target.value })} />
        <div className="flex gap-2 items-center"><span className="muted text-xs">Creative colours</span>
          <input type="color" value={b.creative?.bg} onChange={(e) => setB({ ...b, creative: { ...b.creative, bg: e.target.value } })} className="!w-12 !p-0.5" />
          <input type="color" value={b.creative?.fg} onChange={(e) => setB({ ...b, creative: { ...b.creative, fg: e.target.value } })} className="!w-12 !p-0.5" />
        </div>
        <button className="btn mt-1">Save brand</button>
        {msg && <div className="text-xs">{msg}</div>}
      </form>
    </div>
  );
}
