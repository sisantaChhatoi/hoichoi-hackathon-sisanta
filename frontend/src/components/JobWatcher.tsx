"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, Job } from "@/lib/api";

const KEY = "cuepoint.jobStatus";

/** Polls the job list and raises a toast whenever a job finishes or fails.
 *  Statuses are remembered per browser session so navigating never re-toasts. */
export function JobWatcher() {
  const router = useRouter();
  const seen = useRef<Record<string, string> | null>(null);

  useEffect(() => {
    try { seen.current = JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { seen.current = null; }
    let stop = false;
    const tick = async () => {
      let jobs: Job[];
      try { jobs = await api.jobs(); } catch { return; }
      if (stop) return;
      const next: Record<string, string> = {};
      for (const j of jobs) {
        next[j.id] = j.status;
        const prev = seen.current?.[j.id];
        const wasActive = prev === "running" || prev === "queued";
        if (seen.current && wasActive && j.status === "done") {
          toast.success(`${j.title} is ready`, {
            description: `${j.breaks ?? 0} ad break${j.breaks === 1 ? "" : "s"} placed`,
            action: { label: "View", onClick: () => router.push(`/jobs/${j.id}`) },
            duration: 12000,
          });
        } else if (seen.current && wasActive && j.status === "error") {
          toast.error(`${j.title} failed`, { description: j.message || "Analysis did not complete", duration: 15000 });
        }
      }
      seen.current = next;
      try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch {}
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [router]);

  return null;
}
