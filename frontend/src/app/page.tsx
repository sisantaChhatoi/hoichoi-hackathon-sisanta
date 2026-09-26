"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Upload } from "lucide-react";
import { api, Job } from "@/lib/api";
import { uploadToBlob, blobUploadsEnabled } from "@/lib/blob";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EpisodeList } from "@/components/EpisodeList";
import { cn } from "cn";

const POINTS = [
  ["Where", "Scene boundaries and natural pauses, snapped to real silence — never mid-sentence."],
  ["Whether", "Your pacing rules decide how many breaks an episode can carry, and where they may not go."],
  ["What", "A brand is placed only where its context fits, and never next to scenes it must avoid."],
];

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const load = () => api.jobs().then(setJobs).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    try {
      let job: Job;
      const name = title || (file ? file.name.replace(/\.\w+$/, "") : "");
      if (file) {
        if (await blobUploadsEnabled()) {
          setBusy("Uploading…");
          const publicUrl = await uploadToBlob(file, (p) => setBusy(`Uploading ${p}%`));
          job = await api.createFromUrl(publicUrl, name);
        } else {
          setBusy("Uploading…");
          job = await api.upload(file, name);
        }
      } else if (url) {
        setBusy("Starting…");
        job = await api.createFromUrl(url, name);
      } else return;
      router.push(`/jobs/${job.id}`);
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-14">
      <section className="grid items-center gap-12 py-6 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-16 lg:pr-16">
        <div className="space-y-8">
          <div className="space-y-4">
            <h1 className="text-4xl leading-tight">Ad breaks that respect the story</h1>
            <p className="max-w-lg text-muted-foreground">
              Cuepoint watches an episode the way an editor would, then places every break where it belongs and explains why.
              The result is a VMAP manifest, a decision report, and a preview you can play right here.
            </p>
          </div>
          <ul className="max-w-lg space-y-4">
            {POINTS.map(([k, v]) => (
              <li key={k} className="grid grid-cols-[84px_1fr] gap-3 text-sm">
                <span className="pt-0.5 font-mono text-xs uppercase tracking-wide text-muted-foreground">{k}</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); setFile(e.dataTransfer.files?.[0] ?? null); }}
            onClick={() => fileInput.current?.click()}
            className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input px-4 py-12 text-center text-sm transition-colors",
              drag ? "border-foreground bg-accent/60" : "hover:bg-accent/40")}>
            <Upload className="size-5 text-muted-foreground" />
            {file ? (
              <><span className="font-medium">{file.name}</span><span className="text-xs text-muted-foreground">{(file.size / 1e6).toFixed(0)} MB</span></>
            ) : (
              <><span>Drag a video here, or browse</span><span className="text-xs text-muted-foreground">MP4 · a 25-minute episode takes about four minutes</span></>
            )}
            <input ref={fileInput} type="file" accept="video/mp4,video/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" placeholder="Episode title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="url">Video URL</Label>
            <Input id="url" placeholder="Paste a video link" value={url} onChange={(e) => setUrl(e.target.value)} disabled={!!file} />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={!!busy || (!file && !url)}>
            {busy ?? <>Analyse episode <ArrowRight data-icon="inline-end" /></>}
          </Button>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </form>
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Episodes</h2>
          <span className="text-sm text-muted-foreground">{jobs.length ? `${jobs.length} analysed or in progress` : ""}</span>
        </div>
        <EpisodeList jobs={jobs} limit={8} onRemoved={(id) => setJobs((s) => s.filter((x) => x.id !== id))} />
      </section>
    </div>
  );
}
