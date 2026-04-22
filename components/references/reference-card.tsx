import type { ReferenceItem } from "@/lib/types";

export function ReferenceCard({ reference }: { reference: ReferenceItem }) {
  return (
    <article className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-cyan-200">
        <span>{reference.platform}</span>
        {reference.timestampLabel ? <span>{reference.timestampLabel}</span> : null}
      </div>
      <h3 className="mt-3 text-lg font-semibold text-white">{reference.title}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-300">{reference.excerpt}</p>
      <p className="mt-3 text-sm leading-6 text-slate-400">{reference.contextNote}</p>
      <a
        href={reference.url}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex rounded-full border border-cyan-400/30 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/10"
      >
        Open source
      </a>
    </article>
  );
}
