"use client";
import { useState } from "react";
import { Break, Candidate, Scene, fmt } from "@/lib/api";

const MOOD: Record<string, string> = {
  joyful: "#3ddc84", warm: "#f5b400", neutral: "#6b7280", romantic: "#ec4899", tense: "#f97316",
  suspenseful: "#a855f7", sad: "#3b82f6", grim: "#7f1d1d", comic: "#22d3ee", dramatic: "#e11d48",
};

export default function Timeline({ scenes, breaks, candidates, duration, onSeek }:
  { scenes: Scene[]; breaks: Break[]; candidates: Candidate[]; duration: number; onSeek?: (t: number) => void }) {
  const [hover, setHover] = useState<Scene | null>(null);
  const pct = (t: number) => `${(t / duration) * 100}%`;
  return (
    <div className="panel p-4">
      <div className="flex justify-between text-sm mb-2"><span className="font-semibold">Scene timeline</span><span className="muted">{scenes.length} scenes · {candidates.length} candidates · {breaks.length} breaks</span></div>
      <div className="relative h-10 rounded overflow-hidden bg-[var(--line)]">
        {scenes.map((s) => (
          <div key={s.id} className="absolute top-0 h-full border-r border-black/40 cursor-pointer hover:brightness-125"
            style={{ left: pct(s.start), width: pct(s.end - s.start), background: MOOD[s.mood] ?? "#555", opacity: s.sensitive ? 0.95 : 0.6 }}
            onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(null)} onClick={() => onSeek?.(s.start)} />
        ))}
        {candidates.map((c) => (
          <div key={c.id} className="absolute bottom-0 w-px h-2 bg-white/50" style={{ left: pct(c.time) }} title={`${fmt(c.time)} safety ${c.cut_safety}`} />
        ))}
        {breaks.map((b) => (
          <div key={b.id} className="absolute top-0 w-1 h-full bg-white shadow" style={{ left: pct(b.time) }} title={`${fmt(b.time)} ${b.brand.name}`} />
        ))}
      </div>
      <div className="mt-2 text-xs min-h-[3.5rem]">
        {hover ? (
          <div>
            <span className="font-semibold">{hover.id} · {fmt(hover.start)}–{fmt(hover.end)} · {hover.title}</span>
            <span className="chip ml-2">{hover.mood}</span>{hover.sensitive && <span className="chip chip-bad ml-1">sensitive</span>}
            <span className="chip ml-1">boundary {hover.boundary_quality.toFixed(2)}</span>
            <div className="muted mt-1">{hover.summary}</div>
            <div className="mt-1 flex flex-wrap gap-1">{hover.tags.map((t) => <span key={t} className="chip">{t}</span>)}</div>
          </div>
        ) : <span className="muted">Hover a scene. Colour = mood · white bars = selected breaks · ticks = scored candidates.</span>}
      </div>
    </div>
  );
}
