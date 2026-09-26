"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowRight, Check, ChevronDown, Download, FileJson, RefreshCw, ShieldCheck } from "lucide-react";
import { API, api, Job, Scene, fmt, mediaUrl } from "@/lib/api";
import { STAGES, blockLabel, etaLabel, matchLabel, sourceLabel, stageLabel } from "@/lib/copy";
import Player from "@/components/Player";
import Timeline from "@/components/Timeline";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { cn } from "cn";

const PACING: { key: string; label: string; min: number; max: number; step: number; unit?: string }[] = [
  { key: "max_breaks_per_hour", label: "Breaks per hour", min: 1, max: 12, step: 1 },
  { key: "min_gap_seconds", label: "Minimum gap", min: 60, max: 900, step: 30, unit: "s" },
  { key: "max_ad_load_pct", label: "Ad load", min: 2, max: 25, step: 1, unit: "%" },
  { key: "ad_duration_seconds", label: "Ad length", min: 10, max: 60, step: 5, unit: "s" },
  { key: "min_cut_safety", label: "Minimum cut safety", min: 0.3, max: 0.9, step: 0.05 },
];

const sectionLabel = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState("");
  const [pacing, setPacing] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [seekTo, setSeekTo] = useState<number | null>(null);

  const load = useCallback(() => api.job(id).then(setJob).catch((e) => setErr(String(e))), [id]);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!job || job.status === "running" || job.status === "queued") load(); }, 3000);
    return () => clearInterval(t);
  }, [load, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function replace() {
    setBusy(true);
    try { setJob(await api.place(id, pacing)); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  if (err) return <p className="text-destructive">{err}</p>;
  if (!job) return <p className="text-muted-foreground">Loading…</p>;
  const a = job.analysis, r = job.result;
  const scenesById: Record<string, Scene> = Object.fromEntries((a?.scenes ?? []).map((s) => [s.id, s]));
  const p = { ...(r?.pacing ?? {}), ...pacing };
  const stageIdx = STAGES.indexOf((job.stage ?? "") as typeof STAGES[number]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-4xl">{job.title}</h1>
        {a && <span className="text-sm text-muted-foreground">{fmt(a.media.duration)} · {a.media.width}×{a.media.height}</span>}
        {r && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" nativeButton={false} render={<a href={`${API}/jobs/${id}/vmap.xml`} target="_blank" rel="noreferrer" />}>
              <Download data-icon="inline-start" /> VMAP manifest
            </Button>
            <Button variant="outline" size="sm" nativeButton={false} render={<a href={`${API}/jobs/${id}/debug.json`} target="_blank" rel="noreferrer" />}>
              <FileJson data-icon="inline-start" /> Decision report
            </Button>
          </div>
        )}
      </div>

      {job.status !== "done" && (
        <section className="max-w-3xl space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-medium">{job.status === "error" ? "Analysis failed" : "Analysing"}</h2>
            <p className="text-sm text-muted-foreground">
              {job.status === "error" ? job.message : <>{job.message || stageLabel[job.stage ?? "queued"]}<span className="mx-2">·</span><span className="font-mono">{Math.round(job.progress ?? 0)}%</span>{job.eta_seconds != null && <span className="mx-2">·</span>}{etaLabel(job.eta_seconds)}</>}
            </p>
          </div>
          {job.status !== "error" && <Progress value={job.progress ?? 0} />}
          <ol className="grid gap-2 sm:grid-cols-5">
            {STAGES.map((s, i) => {
              const state = job.status === "error" ? "idle" : i < stageIdx ? "done" : i === stageIdx ? "active" : "idle";
              return (
                <li key={s} className={cn("flex items-center gap-2 text-sm", state === "idle" && "text-muted-foreground")}>
                  <span className={cn("grid size-5 place-items-center rounded-full border text-[10px]",
                    state === "done" && "border-foreground bg-foreground text-background", state === "active" && "border-foreground")}>
                    {state === "done" ? <Check className="size-3" /> : i + 1}
                  </span>
                  {stageLabel[s]}
                </li>
              );
            })}
          </ol>
          {job.status === "error" && (
            <Button size="sm" onClick={() => api.retry(id).then(setJob).catch((e) => setErr(String(e)))}><RefreshCw data-icon="inline-start" /> Retry</Button>
          )}
        </section>
      )}

      {a && r && (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* main column */}
          <div className="space-y-8">
            {job.video_url && <Player src={mediaUrl(job.video_url)} breaks={r.breaks} adSeconds={r.pacing.ad_duration_seconds} duration={a.media.duration} seekTo={seekTo} />}

            <section className="space-y-3">
              <p className={sectionLabel}>Scenes</p>
              <Timeline scenes={a.scenes} breaks={r.breaks} candidates={r.candidates} duration={a.media.duration} onSeek={setSeekTo} />
            </section>

            <section className="space-y-4">
              <div className="flex items-baseline justify-between">
                <p className={sectionLabel}>Ad breaks</p>
                <span className="text-xs text-muted-foreground">{r.breaks.length} placed</span>
              </div>
              {r.breaks.length === 0 && <p className="text-sm text-muted-foreground">No break met the rules for this episode.</p>}
              <div className="divide-y">
                {r.breaks.map((b) => {
                  const blocked = b.brand_rows.filter((x) => x.blocked_by.length);
                  return (
                    <article key={b.id} className="grid gap-x-8 gap-y-2 py-5 first:pt-0 sm:grid-cols-[110px_minmax(0,1fr)]">
                      <div className="space-y-1">
                        <button type="button" onClick={() => setSeekTo(b.time - 4)} className="font-mono text-lg font-semibold hover:underline">{fmt(b.time)}</button>
                        <p className="text-xs text-muted-foreground">{sourceLabel[b.source] ?? b.source}</p>
                        <p className="font-mono text-xs text-muted-foreground">safety {b.cut_safety.toFixed(2)}</p>
                      </div>
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md px-2 py-0.5 text-sm font-semibold" style={{ background: b.brand.creative?.bg, color: b.brand.creative?.fg }}>{b.brand.name}</span>
                          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            {scenesById[b.scene_before]?.title} <ArrowRight className="size-3.5" /> {scenesById[b.scene_after]?.title}
                          </span>
                        </div>
                        <p className="text-sm">{b.rationale}</p>
                        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[130px_1fr]">
                          <dt className="text-muted-foreground">Why this cut</dt><dd>{b.reasons.join(" · ")}</dd>
                          <dt className="text-muted-foreground">Selection</dt><dd>{matchLabel[b.match_method] ?? b.match_method}</dd>
                          {blocked.length > 0 && (<>
                            <dt className="text-muted-foreground">Blocked here</dt>
                            <dd>{blocked.map((x) => `${x.brand_id} (${x.blocked_by.map(blockLabel).join(", ")})`).join(", ")}</dd>
                          </>)}
                          {b.judge && (<>
                            <dt className="text-muted-foreground">Independent review</dt>
                            <dd className="flex flex-wrap items-center gap-1.5">
                              <ShieldCheck className="size-3.5 text-success" />
                              <span>cut {b.judge.cut_verdict}, brand {b.judge.brand_verdict}</span>
                              <span className="text-muted-foreground">— {b.judge.notes}</span>
                            </dd>
                          </>)}
                        </dl>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <Collapsible>
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 border-t pt-5 text-left">
                <div>
                  <p className={sectionLabel}>Other cuts considered</p>
                  <p className="mt-1 text-sm text-muted-foreground">{r.rejected.length} candidates and the rule that ruled each one out</p>
                </div>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-4 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
                  {[...r.rejected].sort((x, y) => x.time - y.time).map((c) => (
                    <div key={c.id} className="flex gap-3">
                      <button type="button" className="w-12 shrink-0 text-left font-mono text-xs hover:underline" onClick={() => setSeekTo(c.time - 3)}>{fmt(c.time)}</button>
                      <span className="text-muted-foreground">{c.rejected_because}</span>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* side column: no box, sticky */}
          <aside className="space-y-6 self-start lg:sticky lg:top-20 lg:border-l lg:pl-8">
            <div className="space-y-1">
              <p className={sectionLabel}>Pacing rules</p>
              <p className="text-sm text-muted-foreground">Whether a break is warranted. Re-placing reuses the analysis and takes seconds.</p>
            </div>
            <div className="space-y-5">
              {PACING.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>{f.label}</Label>
                    <span className="font-mono text-sm text-muted-foreground">{p[f.key]}{f.unit ?? ""}</span>
                  </div>
                  <Slider min={f.min} max={f.max} step={f.step} value={[p[f.key] ?? f.min]}
                    onValueChange={(v) => setPacing({ ...pacing, [f.key]: Array.isArray(v) ? v[0] : v })} />
                </div>
              ))}
            </div>
            <Button className="w-full" onClick={replace} disabled={busy}><RefreshCw data-icon="inline-start" className={busy ? "animate-spin" : ""} /> {busy ? "Re-placing…" : "Re-run placement"}</Button>
          </aside>
        </div>
      )}
    </div>
  );
}
