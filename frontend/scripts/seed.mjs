// Pre-seed the deployed demo: upload sample episodes to Vercel Blob and start a job for each.
//   BLOB_READ_WRITE_TOKEN=... API_URL=https://adbreak-api.onrender.com node scripts/seed.mjs ~/Downloads/bhojon_bilashi.mp4 ...
import { put } from "@vercel/blob";
import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";

const API = process.env.API_URL ?? "http://localhost:8000";
const files = process.argv.slice(2);
if (!files.length) { console.error("usage: node scripts/seed.mjs <video.mp4> [...]"); process.exit(1); }

for (const f of files) {
  const name = basename(f);
  console.log(`uploading ${name} (${(statSync(f).size / 1e6).toFixed(0)} MB) …`);
  const blob = await put(`episodes/${name}`, createReadStream(f), { access: "public", multipart: true, addRandomSuffix: false, allowOverwrite: true });
  console.log("  →", blob.url);
  const title = name.replace(/\.mp4$/, "").replace(/_/g, " ");
  const r = await fetch(`${API}/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: blob.url, title }) });
  const job = await r.json();
  console.log("  job", job.id, job.status);
}
