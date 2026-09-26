import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Nav } from "@/components/Nav";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Cuepoint — context-aware ad breaks",
  description: "Scene-aware ad-break placement for long-form video: where to cut, whether to cut, and which brand belongs there.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans">
        <TooltipProvider>
          <Nav />
          <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted-foreground sm:px-6">
            All brands in the catalogue are fictional.
          </footer>
        </TooltipProvider>
      </body>
    </html>
  );
}
