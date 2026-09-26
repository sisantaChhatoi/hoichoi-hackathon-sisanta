"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Upload } from "lucide-react";
import { api, Job } from "@/lib/api";
import { uploadToBlob, blobUploadsEnabled } from "@/lib/blob";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEFAULT_PACING, PacingControls } from "@/components/PacingControls";
import { EpisodeList } from "@/components/EpisodeList";
import { cn } from "cn";

const POINTS = [
  ["Where", "Scene boundaries and natural pauses, snapped to real silence — never mid-sentence."],
  ["Whether", "Your pacing rules decide how many breaks an episode can carry, and where they may not go."],
  ["What", "A brand is placed only where its context fits, and never next to scenes it must avoid."],
];

export default function Home() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  const [rules, setRules] = useState<Record<string, number>>(DEFAULT_PACING);
  const [confirming, setConfirming] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => { api.pacingDefaults().then(setRules).catch(() => {}); }, []);
  useEffect(() => {
    const load = () => api.jobs().then((j) => { setJobs(j); setErr(""); }).catch(() => setErr("Couldn't reach the API — retrying…"));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  function openRules(e: React.FormEvent) {
    e.preventDefault();
    if (file || url) setConfirming(true);
  }

  async function submit() {
    setConfirming(false); setErr("");
    try {
      let job: Job;
      const name = title || (file ? file.name.replace(/\.\w+$/, "") : "");
      if (file) {
        if (await blobUploadsEnabled()) {
          setBusy("Uploading…");
          try {
            const publicUrl = await uploadToBlob(file, (p) => setBusy(`Uploading ${p}%`));
            job = await api.createFromUrl(publicUrl, name, rules);
          } catch (e) {
            if (!String(e).includes("Not enough storage")) throw e;
            // Storage is full: fall back to a direct upload. Works for this session; the video is not kept across server restarts.
            setBusy("Storage full — uploading directly…");
            job = await api.upload(file, name, rules);
            setErr("Cloud storage is full, so this video was stored on the server temporarily. Free some space by removing an episode.");
          }
        } else {
          setBusy("Uploading…");
          job = await api.upload(file, name, rules);
        }
      } else if (url) {
        setBusy("Starting…");
        job = await api.createFromUrl(url, name, rules);
      } else return;
      router.push(`/jobs/${job.id}`);
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  }

  return (
    <div className="-mt-4 space-y-14">
      <section className="grid items-center gap-12 py-2 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-16 lg:pr-16">
        <div className="space-y-8">
          <div className="space-y-4">
            <h1 className="rise rise-1 text-4xl leading-tight">Ad breaks that respect the story</h1>
            <p className="rise rise-2 max-w-lg text-muted-foreground">
              Cuepoint watches an episode the way an editor would, then places every break where it belongs and explains why.
              The result is a VMAP manifest, a decision report, and a preview you can play right here.
            </p>
          </div>
          <ul className="rise rise-3 max-w-lg space-y-4">
            {POINTS.map(([k, v]) => (
              <li key={k} className="grid grid-cols-[84px_1fr] gap-3 text-sm">
                <span className="pt-0.5 font-mono text-xs uppercase tracking-wide text-muted-foreground">{k}</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </div>

        <form onSubmit={openRules} className="rise rise-4 space-y-5">
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
              <><span>Drag a video here, or browse</span><span className="text-xs text-muted-foreground">MP4 · a 25-minute episode takes about two minutes</span></>
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

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pacing rules for this episode</DialogTitle>
            <DialogDescription>How many breaks it may carry and where they may not go. You can change these afterwards and re-place in seconds.</DialogDescription>
          </DialogHeader>
          <PacingControls value={rules} onChange={setRules} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button onClick={submit}>Start analysis <ArrowRight data-icon="inline-end" /></Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="rise rise-5 space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Episodes</h2>
          <span className="text-sm text-muted-foreground">{err.startsWith("Couldn") ? err : jobs?.length ? `${jobs.length} analysed or in progress` : ""}</span>
        </div>
        <EpisodeList jobs={jobs} limit={8} onRemoved={(id) => setJobs((s) => (s ?? []).filter((x) => x.id !== id))} />
      </section>
    </div>
  );
}
