import Link from "next/link";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/lists", label: "Lists" },
  { href: "/dashboard", label: "Dashboard" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3 text-sm font-semibold text-white">
          <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-1 text-cyan-100">
            NGSL Mood Trainer
          </span>
          <span className="hidden text-slate-300 sm:inline">
            learn by goal, mood, and real usage
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-sm text-slate-300">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
