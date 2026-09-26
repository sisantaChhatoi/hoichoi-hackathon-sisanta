import type { Metadata } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Nav } from "@/components/Nav";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: "Cuepoint — context-aware ad breaks",
  description: "Scene-aware ad-break placement for long-form video: where to cut, whether to cut, and which brand belongs there.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body className="min-h-screen font-sans">
        <div className="aurora" aria-hidden><span className="a1" /></div>
        <TooltipProvider>
          <Nav />
          <main className="mx-auto w-full max-w-[1200px] px-6 py-8 lg:px-8">{children}</main>
          <footer className="mx-auto max-w-[1200px] px-6 pb-8 text-xs text-muted-foreground lg:px-8">
            All brands in the catalogue are fictional.
          </footer>
        </TooltipProvider>
      </body>
    </html>
  );
}
