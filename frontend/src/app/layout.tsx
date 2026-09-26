import type { Metadata } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Nav } from "@/components/Nav";
import { JobWatcher } from "@/components/JobWatcher";
import { Toaster } from "sonner";
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
          <main className="mx-auto w-full max-w-[1320px] px-5 py-12 lg:px-6">{children}</main>
          <footer className="mx-auto max-w-[1320px] px-5 pb-8 text-xs text-muted-foreground lg:px-6">
            All brands in the catalogue are fictional.
          </footer>
          <JobWatcher />
          <Toaster position="bottom-right" closeButton offset={24} gap={12}
            style={{ "--width": "440px", "--toast-close-button-start": "auto", "--toast-close-button-end": "8px", "--toast-close-button-transform": "translate(0, 8px)" } as React.CSSProperties}
            toastOptions={{
              classNames: {
                toast: "!rounded-lg !border !border-border !bg-card !text-foreground !shadow-[var(--shadow-float)] !p-4 !gap-3 font-sans [&_[data-icon]]:!text-foreground [&_[data-icon]]:!size-6 [&_[data-icon]_svg]:!size-6",
                title: "!text-sm !font-medium",
                description: "!text-sm !text-muted-foreground",
                actionButton: "!h-8 !rounded-md !bg-foreground !px-3 !text-sm !font-medium !text-background",
                closeButton: "!static !order-last !ml-2 !size-7 !border-border !bg-transparent !text-muted-foreground hover:!bg-accent",
              },
            }} />
        </TooltipProvider>
      </body>
    </html>
  );
}
