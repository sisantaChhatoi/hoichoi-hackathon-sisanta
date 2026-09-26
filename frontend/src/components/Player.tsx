"use client";
import { useEffect, useRef, useState } from "react";
import { Break, fmt } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/** HTML5 player that honours the ad-break manifest: pauses at each cue point,
 *  plays the matched creative, then resumes content. */
export default function Player({ src, breaks, adSeconds, duration, seekTo }:
  { src: string; breaks: Break[]; adSeconds: number; duration: number; seekTo?: number | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ad, setAd] = useState<Break | null>(null);
  const [left, setLeft] = useState(0);
  const [useCard, setUseCard] = useState(false); // creative mp4 missing → colour card fallback
  const played = useRef(new Set<string>());
  const lastT = useRef(0);
  const [t, setT] = useState(0);

  function onTime() {
    const v = video.current; if (!v || ad) return;
    const now = v.currentTime; setT(now);
    const natural = now - lastT.current < 1.5 && now > lastT.current;
    lastT.current = now;
    if (!natural) return;
    const hit = breaks.find((b) => !played.current.has(b.id) && now >= b.time && now < b.time + 1.5);
    if (hit) { played.current.add(hit.id); v.pause(); setAd(hit); setLeft(adSeconds); setUseCard(false); }
  }

  useEffect(() => {
    if (!ad || !useCard) return; // with an mp4 creative, its onEnded resumes
    const i = setInterval(() => setLeft((s) => { if (s <= 1) { clearInterval(i); resume(); return 0; } return s - 1; }), 1000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad, useCard]);

  useEffect(() => { if (seekTo != null) seek(seekTo); }, [seekTo]); // eslint-disable-line react-hooks/exhaustive-deps

  function resume() { setAd(null); video.current?.play(); }
  function seek(to: number) { const v = video.current; if (!v) return; v.currentTime = Math.max(0, to); lastT.current = v.currentTime; v.play(); }

  const c = ad?.brand.creative ?? {};
  const adSrc = ad ? (c.video_url ?? `/creatives/${ad.brand.id}.mp4`) : "";
  return (
    <div className="overflow-hidden surface">
      <div className="relative aspect-video bg-black">
        <video ref={video} src={src} controls className="h-full w-full" onTimeUpdate={onTime} />
        {ad && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center" style={{ background: c.bg ?? "#222", color: c.fg ?? "#fff" }}>
            {!useCard ? (
              <video src={adSrc} autoPlay className="absolute inset-0 h-full w-full object-contain" onEnded={resume} onError={() => setUseCard(true)} />
            ) : (
              <>
                <div className="mb-3 text-xs uppercase tracking-widest opacity-70">Advertisement · {ad.brand.category}</div>
                <div className="mb-3 text-5xl font-extrabold">{ad.brand.name}</div>
                <div className="text-xl opacity-90">{ad.brand.tagline}</div>
              </>
            )}
            <div className="absolute bottom-3 right-4 flex items-center gap-3 text-xs">
              {useCard && <span className="opacity-80">{left}s</span>}
              <Button size="sm" variant="secondary" onClick={resume}>Skip</Button>
            </div>
          </div>
        )}
      </div>
      <div className="px-4 pb-3 pt-2">
        <div className="relative h-7">
          <div className="absolute inset-x-0 top-3 h-1 rounded-full bg-muted" />
          <div className="absolute left-0 top-3 h-1 rounded-full bg-muted-foreground/60" style={{ width: `${(t / duration) * 100}%` }} />
          {breaks.map((b) => (
            <button key={b.id} type="button" title={`${fmt(b.time)} · ${b.brand.name}`} onClick={() => seek(b.time - 4)}
              className={cn("absolute top-0.5 h-6 w-1.5 rounded-sm transition hover:scale-y-125", played.current.has(b.id) ? "bg-success" : "bg-primary")}
              style={{ left: `calc(${(b.time / duration) * 100}% - 3px)` }} />
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Click a marker to watch that break</span>
          <span className="font-mono">{fmt(t)} / {fmt(duration)}</span>
        </div>
      </div>
    </div>
  );
}
