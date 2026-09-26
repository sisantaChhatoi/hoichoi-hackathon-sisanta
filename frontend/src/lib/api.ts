export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Brand = {
  id: string; name: string; category?: string; tagline?: string;
  target_contexts: string[]; negative_contexts: string[]; negative_description?: string;
  creative?: { bg?: string; fg?: string; video_url?: string; image_url?: string };
};
export type Scene = {
  id: string; start: number; end: number; title: string; summary: string; setting?: string;
  dominant_activity: string; tags: string[]; mood: string; sensitive: boolean;
  ends_on_cliffhanger?: boolean; boundary_quality: number;
};
export type Candidate = {
  id: string; time: number; anchor_time: number; source: string; scene_before: string; scene_after: string;
  cut_safety: number; components: Record<string, number>; reasons: string[]; mid_speech: boolean; rejected_because?: string;
};
export type Verdict = { break_id: string; cut_verdict: string; brand_verdict: string; confidence: number; notes: string };
export type Break = Candidate & {
  brand: Brand; match_method: string; rationale: string;
  brand_rows: { brand_id: string; blocked_by: string[]; affinity: number }[];
  judge?: Verdict;
};
export type Job = {
  id: string; title: string; status: "queued" | "running" | "done" | "error"; stage?: string; progress?: number;
  message?: string; created_at: number; video_url?: string | null; log?: string[];
  analysis?: { media: { duration: number; width: number; height: number }; scenes: Scene[]; speech: { start: number; end: number }[]; silence_count: number; shot_cut_count: number } | null;
  result?: { pacing: Record<string, number>; candidates: Candidate[]; rejected: Candidate[]; breaks: Break[]; vmap: string;
    judge?: (Verdict & { round: number; brand_id: string; time: number })[] } | null;
};

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
export const api = {
  jobs: () => fetch(`${API}/jobs`, { cache: "no-store" }).then(j<Job[]>),
  job: (id: string) => fetch(`${API}/jobs/${id}`, { cache: "no-store" }).then(j<Job>),
  createFromUrl: (url: string, title: string) =>
    fetch(`${API}/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, title }) }).then(j<Job>),
  upload: (file: File, title: string) => {
    const fd = new FormData(); fd.append("file", file); fd.append("title", title);
    return fetch(`${API}/jobs/upload`, { method: "POST", body: fd }).then(j<Job>);
  },
  place: (id: string, pacing?: Record<string, number>) =>
    fetch(`${API}/jobs/${id}/place`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pacing }) }).then(j<Job>),
  brands: () => fetch(`${API}/brands`, { cache: "no-store" }).then(j<{ brands: Brand[]; fallback: Brand }>),
  addBrand: (b: Brand) => fetch(`${API}/brands`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(j<{ brands: Brand[] }>),
  deleteBrand: (id: string) => fetch(`${API}/brands/${id}`, { method: "DELETE" }).then(j<{ brands: Brand[] }>),
  vocab: () => fetch(`${API}/vocab`).then(j<{ tags: string[]; moods: string[] }>),
};

export const mediaUrl = (u?: string | null) => (!u ? "" : u.startsWith("http") ? u : `${API}${u}`);
export const fmt = (t: number) => {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};
