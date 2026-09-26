"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, Job } from "@/lib/api";
import { uploadToBlob, blobUploadsEnabled } from "@/lib/blob";

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const router = useRouter();

  useEffect(() => {
    api.jobs().then(setJobs).catch(() => {});
    const t = setInterval(() => api.jobs().then(setJobs).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    try {
      let job: Job;
      if (file) {
        if (await blobUploadsEnabled()) {
          setBusy("Uploading to storage…");
          const publicUrl = await uploadToBlob(file, (p) => setBusy(`Uploading… ${p}%`));
          job = await api.createFromUrl(publicUrl, title || file.name);
        } else {
          setBusy("Uploading to backend…");
          job = await api.upload(file, title || file.name);
        }
      } else if (url) {
        setBusy("Starting…");
        job = await api.createFromUrl(url, title);
      } else return;
      router.push(`/jobs/${job.id}`);
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1.4fr]">
      <form onSubmit={submit} className="panel p-5 flex flex-col gap-3 h-fit">
        <h2 className="font-semibold text-lg">Analyse an episode</h2>
        <p className="text-sm muted">Upload a Bengali drama episode (mp4). The pipeline segments scenes, scores every possible break, and matches a brand from the catalogue. ~5 min for a 20-min episode.</p>
        <input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input type="file" accept="video/mp4,video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <div className="text-xs muted text-center">— or —</div>
        <input placeholder="Direct video URL (https://…/episode.mp4)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn" disabled={!!busy || (!file && !url)}>{busy ?? "Run pipeline"}</button>
        {err && <div className="text-sm" style={{ color: "var(--bad)" }}>{err}</div>}
      </form>

      <div className="panel p-5">
        <h2 className="font-semibold text-lg mb-3">Jobs</h2>
        {jobs.length === 0 && <div className="muted text-sm">No jobs yet.</div>}
        <ul className="divide-y divide-[var(--line)]">
          {jobs.map((j) => (
            <li key={j.id} className="py-3 flex items-center gap-3">
              <Link href={`/jobs/${j.id}`} className="font-medium hover:underline flex-1 truncate">{j.title}</Link>
              <Status job={j} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Status({ job }: { job: Job }) {
  const color = job.status === "done" ? "var(--ok)" : job.status === "error" ? "var(--bad)" : "var(--accent)";
  return (
    <span className="text-xs flex items-center gap-2" style={{ color }}>
      {job.status === "running" && <span className="w-24 h-1.5 rounded bg-[var(--line)] overflow-hidden"><span className="block h-full" style={{ width: `${job.progress ?? 0}%`, background: color }} /></span>}
      {job.status}{job.status === "running" && job.stage ? ` · ${job.stage}` : ""}
    </span>
  );
}
