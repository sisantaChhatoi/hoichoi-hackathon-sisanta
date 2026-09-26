"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API, api, Job, Scene, fmt, mediaUrl } from "@/lib/api";
import Player from "@/components/Player";
import Timeline from "@/components/Timeline";

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState("");
  const [pacing, setPacing] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

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

  if (err) return <div style={{ color: "var(--bad)" }}>{err}</div>;
  if (!job) return <div className="muted">Loading…</div>;
  const a = job.analysis, r = job.result;
  const scenesById: Record<string, Scene> = Object.fromEntries((a?.scenes ?? []).map((s) => [s.id, s]));
  const p = { ...(r?.pacing ?? {}), ...pacing };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4 flex-wrap">
        <h1 className="text-xl font-bold">{job.title}</h1>
        <span className="chip">{job.status}{job.stage && job.status !== "done" ? ` · ${job.stage}` : ""}</span>
        {a && <span className="muted text-sm">{fmt(a.media.duration)} · {a.media.width}×{a.media.height} · {a.silence_count} silences · {a.shot_cut_count} shot cuts</span>}
        {r && (
          <span className="ml-auto flex gap-2">
            <a className="btn-ghost text-sm" href={`${API}/jobs/${id}/vmap.xml`} target="_blank">VMAP manifest</a>
            <a className="btn-ghost text-sm" href={`${API}/jobs/${id}/debug.json`} target="_blank">Debug JSON</a>
          </span>
        )}
      </div>

      {job.status !== "done" && (
        <div className="panel p-4">
          <div className="flex justify-between text-sm mb-2"><span>{job.message || job.stage}</span><span>{job.progress ?? 0}%</span></div>
          <div className="h-2 rounded bg-[var(--line)] overflow-hidden"><div className="h-full" style={{ width: `${job.progress ?? 0}%`, background: job.status === "error" ? "var(--bad)" : "var(--accent)" }} /></div>
          <pre className="mt-3 text-xs muted max-h-48 overflow-auto whitespace-pre-wrap">{(job.log ?? []).slice(-15).join("\n")}</pre>
        </div>
      )}

      {a && r && (
        <>
          {job.video_url && <Player src={mediaUrl(job.video_url)} breaks={r.breaks} adSeconds={r.pacing.ad_duration_seconds} duration={a.media.duration} />}
          <Timeline scenes={a.scenes} breaks={r.breaks} candidates={r.candidates} duration={a.media.duration} />

          <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <div className="panel p-4">
              <h2 className="font-semibold mb-3">Ad breaks ({r.breaks.length})</h2>
              {r.breaks.map((b, i) => {
                const blocked = b.brand_rows.filter((x) => x.blocked_by.length);
                return (
                  <div key={b.id} className="border-t border-[var(--line)] py-3 text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold">#{i + 1} @ {fmt(b.time)}</span>
                      <span className="px-2 py-0.5 rounded font-semibold" style={{ background: b.brand.creative?.bg, color: b.brand.creative?.fg }}>{b.brand.name}</span>
                      <span className="chip chip-ok">safety {b.cut_safety.toFixed(2)}</span>
                      <span className="chip">{b.source.replace("_", " ")}</span>
                      <span className="chip">{b.match_method}</span>
                    </div>
                    <div className="muted mt-1">{scenesById[b.scene_before]?.title} → {scenesById[b.scene_after]?.title}</div>
                    <div className="mt-1">{b.rationale}</div>
                    <div className="mt-1 text-xs muted">Cut: {b.reasons.join(" · ")}</div>
                    {blocked.length > 0 && (
                      <div className="mt-1 text-xs flex flex-wrap gap-1 items-center"><span className="muted">Hard-blocked:</span>
                        {blocked.map((x) => <span key={x.brand_id} className="chip chip-bad">{x.brand_id} ✕ {x.blocked_by.join(",")}</span>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-5">
              <div className="panel p-4 text-sm">
                <h2 className="font-semibold mb-2">Pacing rules (Whether)</h2>
                {(["max_breaks_per_hour", "min_gap_seconds", "max_ad_load_pct", "ad_duration_seconds", "min_cut_safety"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2 mb-1.5"><span className="w-44 muted text-xs">{k}</span>
                    <input type="number" step="any" value={p[k]} onChange={(e) => setPacing({ ...pacing, [k]: Number(e.target.value) })} /></label>
                ))}
                <button className="btn mt-2 w-full" onClick={replace} disabled={busy}>{busy ? "Re-placing…" : "Re-run placement (scoring + matching only)"}</button>
                <div className="muted text-xs mt-2">Also use this after adding a brand in the catalogue — analysis is reused, so it takes seconds.</div>
              </div>

              <div className="panel p-4 text-sm">
                <h2 className="font-semibold mb-2">Rejected candidates ({r.rejected.length})</h2>
                <div className="max-h-72 overflow-auto">
                  {r.rejected.sort((x, y) => x.time - y.time).map((c) => (
                    <div key={c.id} className="border-t border-[var(--line)] py-1.5 text-xs">
                      <span className="font-mono">{fmt(c.time)}</span> <span className="chip">{c.cut_safety.toFixed(2)}</span> <span className="muted">{c.rejected_because}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
