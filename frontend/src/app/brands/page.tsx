"use client";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api, Brand } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";

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
      const id = b.id || b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const c = await api.addBrand({ ...b, id });
      setBrands(c.brands); setB(empty); setMsg(`Saved ${b.name}. Open any episode and re-run placement to see it considered.`);
    } catch (e) { setMsg(String(e)); }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Brand catalogue</h1>
        <p className="max-w-2xl text-muted-foreground">
          Every brand is fictional. <b>Target contexts</b> attract a brand to a scene; <b>negative contexts</b> are a hard block —
          the brand is never placed next to a scene carrying any of them. New brands are matched with no code changes.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid gap-4 sm:grid-cols-2">
          {brands.map((x) => (
            <Card key={x.id} className="gap-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="rounded-md px-2 py-0.5 text-sm font-semibold" style={{ background: x.creative?.bg, color: x.creative?.fg }}>{x.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">{x.category}</span>
                  <Button variant="ghost" size="icon" className="ml-auto" aria-label="Remove" onClick={() => api.deleteBrand(x.id).then((c) => setBrands(c.brands))}><Trash2 /></Button>
                </CardTitle>
                <CardDescription>{x.tagline}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-1">{x.target_contexts.map((t) => <Badge key={t} variant="outline" className="border-success/40 text-success">{t}</Badge>)}</div>
                <div className="flex flex-wrap gap-1">{x.negative_contexts.map((t) => <Badge key={t} variant="outline" className="border-destructive/40 text-destructive">{t}</Badge>)}</div>
                {x.negative_description && <p className="text-xs italic text-muted-foreground">{x.negative_description}</p>}
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Add a brand</CardTitle>
            <CardDescription>Uses the same context vocabulary as the scene analysis.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="name">Name</Label><Input id="name" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} required /></div>
                <div className="space-y-1.5"><Label htmlFor="cat">Category</Label><Input id="cat" value={b.category} onChange={(e) => setB({ ...b, category: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="tag">Tagline</Label><Input id="tag" value={b.tagline} onChange={(e) => setB({ ...b, tagline: e.target.value })} /></div>
              <TagPicker label="Target contexts" tags={tags} selected={b.target_contexts} onToggle={(t) => toggle("target_contexts", t)} tone="success" />
              <TagPicker label="Negative contexts (hard block)" tags={tags} selected={b.negative_contexts} onToggle={(t) => toggle("negative_contexts", t)} tone="destructive" />
              <div className="space-y-1.5">
                <Label htmlFor="rule">Extra rule (optional)</Label>
                <Textarea id="rule" placeholder="e.g. never after a scene where food is wasted" value={b.negative_description} onChange={(e) => setB({ ...b, negative_description: e.target.value })} />
              </div>
              <div className="flex items-center gap-3">
                <Label>Creative colours</Label>
                <input type="color" value={b.creative?.bg} onChange={(e) => setB({ ...b, creative: { ...b.creative, bg: e.target.value } })} className="size-8 cursor-pointer rounded border bg-transparent" />
                <input type="color" value={b.creative?.fg} onChange={(e) => setB({ ...b, creative: { ...b.creative, fg: e.target.value } })} className="size-8 cursor-pointer rounded border bg-transparent" />
              </div>
              <Button type="submit" className="w-full">Save brand</Button>
              {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TagPicker({ label, tags, selected, onToggle, tone }: { label: string; tags: string[]; selected: string[]; onToggle: (t: string) => void; tone: "success" | "destructive" }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1">
        {tags.map((t) => {
          const on = selected.includes(t);
          return (
            <button type="button" key={t} onClick={() => onToggle(t)}
              className={cn("rounded-full border px-2 py-0.5 text-xs transition-colors",
                on ? (tone === "success" ? "border-success/60 bg-success/10 text-success" : "border-destructive/60 bg-destructive/10 text-destructive") : "text-muted-foreground hover:bg-accent")}>
              {t}
            </button>
          );
        })}
      </div>
    </div>
  );
}
