"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard } from "lucide-react";
import { cn } from "cn";

const links = [
  { href: "/", label: "Episodes" },
  { href: "/brands", label: "Brands" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-8 px-6 lg:px-10">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <Clapperboard className="size-4" />
          </span>
          Cuepoint
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {links.map((l) => {
            const active = l.href === "/" ? path === "/" || path.startsWith("/jobs") : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href}
                className={cn("rounded-full px-3 py-1.5 transition-colors hover:bg-accent hover:text-accent-foreground",
                  active ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
