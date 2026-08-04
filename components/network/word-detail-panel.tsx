"use client";

import { useMemo, useRef } from "react";

import type { WikiPage } from "@/lib/wiki/parse-wiki";
import type { WordDetail } from "@/lib/content/word-detail";

const CONN_LABEL: Record<string, string> = {
  advanced_form: "Level up to",
  builds_on: "Builds on",
  synonym: "Synonyms",
  antonym: "Antonyms",
  intensity: "Stronger / weaker",
  collocation: "Goes with",
  morphological: "Word family",
};
// Order the sections so the signature "level up" ladder leads.
const CONN_ORDER = [
  "advanced_form",
  "builds_on",
  "synonym",
  "antonym",
  "intensity",
  "collocation",
  "morphological",
];

function PlayButton({ url, label }: { url: string; label: string }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  return (
    <button
      onClick={() => ref.current?.play()}
      className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-xs text-sky-200 transition hover:bg-white/15"
    >
      <span aria-hidden>🔊</span> {label}
      <audio ref={ref} src={url} preload="none" />
    </button>
  );
}

export function WordDetailPanel({
  page,
  detail,
  nodeIds,
  owned,
  onCollect,
  onSelect,
  onClose,
}: {
  page: WikiPage;
  detail: WordDetail | null;
  nodeIds: Set<string>;
  owned: Set<string>;
  onCollect: (lemma: string) => void;
  onSelect: (lemma: string) => void;
  onClose: () => void;
}) {
  const isOwned = owned.has(page.lemma);
  const grouped = useMemo(() => {
    const map = new Map<string, WikiPage["connections"]>();
    for (const c of page.connections) map.set(c.type, [...(map.get(c.type) ?? []), c]);
    return CONN_ORDER.filter((t) => map.has(t)).map((t) => [t, map.get(t)!] as const);
  }, [page.connections]);

  // Extra dictionary senses that aren't just a repeat of the wiki definition.
  const extraSenses = (detail?.senses ?? []).filter(
    (s) => s.definition.toLowerCase().trim() !== page.definition.toLowerCase().trim(),
  );

  return (
    <div className="flex h-full flex-col overflow-hidden text-slate-100">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-3xl font-semibold tracking-tight">{page.display}</h2>
            <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-slate-300">
              {page.pos}
            </span>
            {page.tier === "advanced" && (
              <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-xs font-medium text-violet-200">
                advanced
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-400">
            {detail?.ipa && <span className="font-mono text-sky-200">{detail.ipa}</span>}
            {detail?.audioUk && <PlayButton url={detail.audioUk} label="UK" />}
            {detail?.audioUs && <PlayButton url={detail.audioUs} label="US" />}
            {!detail?.audioUk && !detail?.audioUs && detail?.audioAny && (
              <PlayButton url={detail.audioAny} label="Listen" />
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-full border border-white/10 px-2.5 py-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <button
          onClick={() => !isOwned && onCollect(page.lemma)}
          disabled={isOwned}
          className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
            isOwned
              ? "cursor-default bg-emerald-500/15 text-emerald-300"
              : "bg-gradient-to-r from-sky-500 to-violet-500 text-white hover:opacity-90"
          }`}
        >
          {isOwned ? "✓ In your space" : "⭐ Collect this word"}
        </button>

        <section>
          <p className="text-[15px] leading-7 text-slate-100">{page.definition}</p>
          {page.domains.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {page.domains.map((d) => (
                <span key={d} className="rounded bg-white/5 px-2 py-0.5 text-[11px] uppercase tracking-wide text-slate-400">
                  {d}
                </span>
              ))}
            </div>
          )}
        </section>

        {page.examples.length > 0 && (
          <Section title="Examples">
            <ul className="space-y-1.5">
              {page.examples.map((ex, i) => (
                <li key={i} className="border-l-2 border-sky-400/40 pl-3 text-sm italic leading-6 text-slate-300">
                  {ex}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {grouped.map(([type, conns]) => (
          <Section key={type} title={CONN_LABEL[type] ?? type.replace(/_/g, " ")} highlight={type === "advanced_form"}>
            <div className="space-y-2">
              {conns.map((c) => {
                const exists = nodeIds.has(c.target);
                return (
                  <div key={`${type}-${c.target}`} className="flex flex-wrap items-baseline gap-x-2">
                    {exists ? (
                      <button
                        onClick={() => onSelect(c.target)}
                        className={`rounded-md px-2 py-0.5 text-sm font-medium transition ${
                          type === "advanced_form"
                            ? "bg-violet-500/20 text-violet-100 hover:bg-violet-500/35"
                            : "bg-white/5 text-sky-200 hover:bg-white/15"
                        }`}
                      >
                        {c.target}
                      </button>
                    ) : (
                      <span className="rounded-md border border-dashed border-white/15 px-2 py-0.5 text-sm text-slate-500">
                        {c.target}
                      </span>
                    )}
                    {c.gloss && <span className="text-xs leading-5 text-slate-400">{c.gloss}</span>}
                  </div>
                );
              })}
            </div>
          </Section>
        ))}

        {page.forms.length > 1 && (
          <Section title="Word family">
            <div className="flex flex-wrap gap-1.5">
              {page.forms.map((f) => (
                <span key={f} className="rounded bg-white/5 px-2 py-0.5 text-sm text-slate-300">
                  {f}
                </span>
              ))}
            </div>
          </Section>
        )}

        {extraSenses.length > 0 && (
          <Section title="More senses (dictionary)">
            <ul className="space-y-2">
              {extraSenses.map((s, i) => (
                <li key={i} className="text-sm leading-6">
                  {s.partOfSpeech && (
                    <span className="mr-2 text-xs italic text-slate-500">{s.partOfSpeech}</span>
                  )}
                  <span className="text-slate-200">{s.definition}</span>
                  {s.example && <div className="mt-0.5 pl-3 text-xs italic text-slate-400">“{s.example}”</div>}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  highlight,
}: {
  title: string;
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <section>
      <h3
        className={`mb-2 text-xs font-semibold uppercase tracking-[0.16em] ${
          highlight ? "text-violet-300" : "text-slate-500"
        }`}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}
