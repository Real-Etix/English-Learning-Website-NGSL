import Link from "next/link";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/lists", label: "Lists" },
  { href: "/network/ngsl", label: "Galaxy" },
  { href: "/dashboard", label: "Dashboard" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/90 backdrop-blur-md shadow-sm">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3 text-sm font-semibold text-slate-900">
          <span className="rounded-full border border-cyan-500/40 bg-cyan-100 px-3 py-1 text-cyan-900">
            NGSL Mood Trainer
          </span>
          <span className="hidden text-slate-600 sm:inline">
            learn by goal, mood, and real usage
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-sm text-slate-600">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full px-3 py-2 transition hover:bg-sky-100 hover:text-slate-900"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
