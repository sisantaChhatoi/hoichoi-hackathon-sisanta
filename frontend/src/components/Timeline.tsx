"use client";
import { useState } from "react";
import { Break, Candidate, Scene, fmt } from "@/lib/api";
import { moodColor } from "@/lib/copy";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Timeline({ scenes, breaks, candidates, duration, onSeek }:
  { scenes: Scene[]; breaks: Break[]; candidates: Candidate[]; duration: number; onSeek?: (t: number) => void }) {
  const [hover, setHover] = useState<Scene | null>(null);
  const pct = (t: number) => `${(t / duration) * 100}%`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Scenes</CardTitle>
        <CardDescription>{scenes.length} scenes · {candidates.length} candidate cuts · {breaks.length} breaks placed</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative h-10 overflow-hidden rounded-md bg-muted">
          {scenes.map((s) => (
            <div key={s.id} className="absolute top-0 h-full cursor-pointer border-r border-background/60 transition hover:brightness-125"
              style={{ left: pct(s.start), width: pct(s.end - s.start), background: moodColor[s.mood] ?? "var(--muted-foreground)", opacity: s.sensitive ? 0.95 : 0.55 }}
              onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(null)} onClick={() => onSeek?.(s.start)} />
          ))}
          {candidates.map((c) => (
            <div key={c.id} className="absolute bottom-0 h-2 w-px bg-foreground/40" style={{ left: pct(c.time) }} />
          ))}
          {breaks.map((b) => (
            <div key={b.id} className="absolute top-0 h-full w-1 bg-foreground shadow" style={{ left: pct(b.time) }} title={`${fmt(b.time)} · ${b.brand.name}`} />
          ))}
        </div>
        <div className="min-h-16 text-sm">
          {hover ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{hover.title}</span>
                <span className="font-mono text-xs text-muted-foreground">{fmt(hover.start)}–{fmt(hover.end)}</span>
                <Badge variant="secondary">{hover.mood}</Badge>
                {hover.sensitive && <Badge variant="destructive">sensitive</Badge>}
              </div>
              <p className="text-muted-foreground">{hover.summary}</p>
              <div className="flex flex-wrap gap-1">{hover.tags.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}</div>
            </div>
          ) : (
            <p className="text-muted-foreground">Hover a scene for its summary and context tags. Colour is mood; bright bars are placed breaks, small ticks are every cut that was considered.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
