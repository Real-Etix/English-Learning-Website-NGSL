import type { SourceCredit } from "@/lib/types";

export function SourceCreditBadges({
  credits,
  asLinks = true,
}: {
  credits: SourceCredit[];
  asLinks?: boolean;
}) {
  if (credits.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {credits.map((credit) =>
        asLinks ? (
          <a
            key={credit.id}
            href={credit.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 transition hover:bg-white/10"
          >
            {credit.label}
          </a>
        ) : (
          <span
            key={credit.id}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300"
          >
            {credit.label}
          </span>
        ),
      )}
    </div>
  );
}
