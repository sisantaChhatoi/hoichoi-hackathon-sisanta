"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Film, Upload, Trash2, ArrowRight } from "lucide-react";
import { api, Job, fmt } from "@/lib/api";
import { uploadToBlob, blobUploadsEnabled } from "@/lib/blob";
import { stageLabel } from "@/lib/copy";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";

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
      if (file) {
        if (await blobUploadsEnabled()) {
          setBusy("Uploading…");
          const publicUrl = await uploadToBlob(file, (p) => setBusy(`Uploading ${p}%`));
          job = await api.createFromUrl(publicUrl, title || file.name.replace(/\.\w+$/, ""));
        } else {
          setBusy("Uploading…");
          job = await api.upload(file, title || file.name.replace(/\.\w+$/, ""));
        }
      } else if (url) {
        setBusy("Starting…");
        job = await api.createFromUrl(url, title);
      } else return;
      router.push(`/jobs/${job.id}`);
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Context-aware ad breaks</h1>
        <p className="max-w-2xl text-muted-foreground">
          Upload an episode. Cuepoint segments it into scenes, finds cuts a viewer won&apos;t notice, decides how many breaks the
          pacing rules allow, and places the brand that fits each moment — with a manifest, a decision report and a playable preview.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader>
            <CardTitle>New episode</CardTitle>
            <CardDescription>MP4, any length. A 25-minute episode takes about four minutes.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); setFile(e.dataTransfer.files?.[0] ?? null); }}
                onClick={() => fileInput.current?.click()}
                className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm transition-colors",
                  drag ? "border-primary bg-primary/5" : "hover:bg-accent/40")}>
                <Upload className="size-5 text-muted-foreground" />
                {file ? <span className="font-medium">{file.name}</span> : <span className="text-muted-foreground">Drop a video here or click to choose</span>}
                {file && <span className="text-xs text-muted-foreground">{(file.size / 1e6).toFixed(0)} MB</span>}
                <input ref={fileInput} type="file" accept="video/mp4,video/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="title">Title</Label>
                <Input id="title" placeholder="Optional" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="url">or video URL</Label>
                <Input id="url" placeholder="https://…/episode.mp4" value={url} onChange={(e) => setUrl(e.target.value)} disabled={!!file} />
              </div>
              <Button type="submit" className="w-full" disabled={!!busy || (!file && !url)}>
                {busy ?? "Analyse episode"}
              </Button>
              {err && <p className="text-sm text-destructive">{err}</p>}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Episodes</CardTitle>
            <CardDescription>{jobs.length ? `${jobs.length} analysed or in progress` : "Nothing analysed yet"}</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {jobs.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10 pr-6" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell className="pl-6">
                        <Link href={`/jobs/${j.id}`} className="flex items-center gap-2 font-medium hover:underline">
                          <Film className="size-4 text-muted-foreground" />{j.title}
                          <ArrowRight className="size-3.5 text-muted-foreground" />
                        </Link>
                      </TableCell>
                      <TableCell><Status job={j} /></TableCell>
                      <TableCell className="pr-6 text-right">
                        <Button variant="ghost" size="icon" aria-label="Remove"
                          onClick={() => { if (confirm(`Remove "${j.title}"?`)) api.deleteJob(j.id).then(() => setJobs((s) => s.filter((x) => x.id !== j.id))); }}>
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Status({ job }: { job: Job }) {
  if (job.status === "done") return <Badge variant="outline" className="border-success/40 text-success">Ready</Badge>;
  if (job.status === "error") return <Badge variant="destructive">Failed</Badge>;
  return (
    <div className="flex min-w-40 items-center gap-2">
      <Progress value={job.progress ?? 0} className="w-24" />
      <span className="text-xs text-muted-foreground">{stageLabel[job.stage ?? "queued"] ?? job.stage}</span>
    </div>
  );
}

export { fmt };
