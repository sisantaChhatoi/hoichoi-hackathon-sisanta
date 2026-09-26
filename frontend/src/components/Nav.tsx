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
    <header className="sticky top-0 z-20 border-b bg-background/40 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-8 px-5 lg:px-6">
        <Link href="/" className="flex items-center gap-2">
          <Clapperboard className="size-5" strokeWidth={1.75} />
          <span className="font-serif text-2xl leading-none">Cuepoint</span>
        </Link>
        <nav className="ml-auto flex h-14 items-stretch gap-6 text-sm">
          {links.map((l) => {
            const active = l.href === "/" ? path === "/" || path.startsWith("/jobs") : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href}
                className={cn("flex items-center border-b-2 pt-0.5 transition-colors hover:text-foreground",
                  active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground")}>
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
