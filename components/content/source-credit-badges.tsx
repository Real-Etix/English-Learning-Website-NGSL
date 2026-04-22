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
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            {credit.label}
          </a>
        ) : (
          <span
            key={credit.id}
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600"
          >
            {credit.label}
          </span>
        ),
      )}
    </div>
  );
}
