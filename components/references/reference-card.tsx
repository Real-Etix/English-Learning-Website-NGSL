import type { ReferenceItem } from "@/lib/types";

export function ReferenceCard({ reference }: { reference: ReferenceItem }) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-cyan-800">
        <span>{reference.platform}</span>
        {reference.timestampLabel ? <span>{reference.timestampLabel}</span> : null}
      </div>
      <h3 className="mt-3 text-lg font-semibold text-slate-900">{reference.title}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-600">{reference.excerpt}</p>
      <p className="mt-3 text-sm leading-6 text-slate-500">{reference.contextNote}</p>
      <a
        href={reference.url}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex rounded-full border border-cyan-400/60 px-4 py-2 text-sm font-medium text-cyan-800 transition hover:bg-cyan-50"
      >
        Open source
      </a>
    </article>
  );
}
