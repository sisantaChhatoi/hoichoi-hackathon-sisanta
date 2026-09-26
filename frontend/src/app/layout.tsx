import type { Metadata } from "next";
import { Inter, Fraunces, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Nav } from "@/components/Nav";
import { JobWatcher } from "@/components/JobWatcher";
import { Toaster } from "sonner";
import { CircleAlert, CircleCheck } from "lucide-react";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const serif = Fraunces({ subsets: ["latin"], axes: ["opsz", "SOFT"], variable: "--font-serif" });

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
          <JobWatcher />
          <Toaster position="bottom-right" closeButton offset={24} gap={12}
            icons={{ success: <CircleCheck className="size-7 text-success" strokeWidth={1.75} />, error: <CircleAlert className="size-7 text-destructive" strokeWidth={1.75} /> }}
            style={{ "--width": "440px", "--toast-close-button-start": "auto", "--toast-close-button-end": "8px", "--toast-close-button-transform": "translate(0, 6px)" } as React.CSSProperties}
            toastOptions={{
              classNames: {
                toast: "!rounded-lg !border !border-border !bg-card !text-foreground !shadow-[var(--shadow-float)] !p-4 !gap-3 font-sans !pr-9 [&_[data-icon]]:!size-7 [&_[data-icon]]:!shrink-0",
                title: "!text-sm !font-medium",
                description: "!text-sm !text-muted-foreground",
                actionButton: "!h-8 !rounded-md !bg-secondary !px-3 !text-sm !font-medium !text-foreground hover:!bg-accent",
                closeButton: "!size-6 !rounded-none !border-0 !bg-transparent !shadow-none !text-muted-foreground hover:!bg-transparent hover:!text-foreground",
              },
            }} />
        </TooltipProvider>
      </body>
    </html>
  );
}
