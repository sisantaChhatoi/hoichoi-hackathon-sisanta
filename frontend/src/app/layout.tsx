import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Nav } from "@/components/Nav";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Cuepoint — context-aware ad breaks",
  description: "Scene-aware ad-break placement for long-form video: where to cut, whether to cut, and which brand belongs there.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans">
        <TooltipProvider>
          <Nav />
          <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted-foreground sm:px-6">
            All brands in the catalogue are fictional.
          </footer>
        </TooltipProvider>
      </body>
    </html>
  );
}
