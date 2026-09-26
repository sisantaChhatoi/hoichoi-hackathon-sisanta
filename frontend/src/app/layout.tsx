import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdBreak AI — contextual ad placement",
  description: "Context-aware video segmentation & intelligent ad placement for Bengali drama (hoichoi Hackathon '26, Problem 1)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-[var(--line)]">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-6">
            <Link href="/" className="font-bold text-lg"><span style={{ color: "var(--accent)" }}>▶</span> AdBreak AI</Link>
            <nav className="flex gap-4 text-sm muted">
              <Link href="/" className="hover:text-white">Jobs</Link>
              <Link href="/brands" className="hover:text-white">Brand catalogue</Link>
            </nav>
            <span className="ml-auto text-xs muted">hoichoi Hackathon &apos;26 · Problem 1</span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
