"use client";
import { useEffect, useRef, useState } from "react";
import { Break, fmt } from "@/lib/api";

/** HTML5 player that honours the ad-break manifest: pauses at each cue point,
 *  plays the matched creative, then resumes content. */
export default function Player({ src, breaks, adSeconds, duration }: { src: string; breaks: Break[]; adSeconds: number; duration: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const adVideo = useRef<HTMLVideoElement>(null);
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

  function resume() { setAd(null); video.current?.play(); }
  function seek(to: number) { const v = video.current; if (!v) return; v.currentTime = Math.max(0, to); lastT.current = v.currentTime; v.play(); }

  const c = ad?.brand.creative ?? {};
  const adSrc = ad ? (c.video_url ?? `/creatives/${ad.brand.id}.mp4`) : "";
  return (
    <div className="panel overflow-hidden">
      <div className="relative bg-black aspect-video">
        <video ref={video} src={src} controls className="w-full h-full" onTimeUpdate={onTime} />
        {ad && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8" style={{ background: c.bg ?? "#222", color: c.fg ?? "#fff" }}>
            {!useCard ? (
              <video ref={adVideo} src={adSrc} autoPlay className="absolute inset-0 w-full h-full object-contain" onEnded={resume} onError={() => setUseCard(true)} />
            ) : (
              <>
                <div className="text-xs uppercase tracking-widest opacity-70 mb-3">Advertisement · {ad.brand.category}</div>
                <div className="text-5xl font-extrabold mb-3">{ad.brand.name}</div>
                <div className="text-xl opacity-90">{ad.brand.tagline}</div>
              </>
            )}
            <div className="absolute bottom-3 right-4 text-xs opacity-80 flex gap-3 items-center">
              {useCard && <span>{left}s</span>}
              <button className="btn-ghost !py-1 !px-2" onClick={resume}>Skip ad</button>
            </div>
            <div className="absolute top-3 left-4 text-xs opacity-80 max-w-md text-left">Why here: {ad.rationale}</div>
          </div>
        )}
      </div>
      {/* cue bar */}
      <div className="relative h-8 mx-3 my-2">
        <div className="absolute top-3.5 left-0 right-0 h-1 rounded bg-[var(--line)]" />
        <div className="absolute top-3.5 left-0 h-1 rounded" style={{ width: `${(t / duration) * 100}%`, background: "var(--muted)" }} />
        {breaks.map((b) => (
          <button key={b.id} title={`${fmt(b.time)} · ${b.brand.name}`} onClick={() => seek(b.time - 4)}
            className="absolute -top-0.5 w-2 h-8 rounded-sm hover:scale-125 transition" style={{ left: `calc(${(b.time / duration) * 100}% - 4px)`, background: played.current.has(b.id) ? "var(--ok)" : "var(--accent)" }} />
        ))}
      </div>
      <div className="px-3 pb-3 text-xs muted">Click a marker to jump 4s before that break and watch the cut-over. {fmt(t)} / {fmt(duration)}</div>
    </div>
  );
}
