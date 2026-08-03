"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { WordDetailPanel } from "@/components/network/word-detail-panel";
import type { GraphNode, LiteGraph, WikiPage } from "@/lib/wiki/parse-wiki";
import type { WordDetail } from "@/lib/content/word-detail";

// Three.js touches the DOM/WebGL, so load the galaxy only in the browser.
const WordGalaxy = dynamic(() => import("@/components/network/word-galaxy"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[640px] items-center justify-center rounded-[2rem] bg-[#05060f] text-sm text-slate-500">
      Charting the vocabulary galaxy…
    </div>
  ),
});

type WordResponse = { page: WikiPage; detail: WordDetail | null };

export function GalaxyClient({ graph }: { graph: LiteGraph }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<WordResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Which lemmas are stars in this galaxy — so the drawer knows what's clickable.
  const nodeIds = useMemo(() => new Set(graph.nodes.map((n) => n.lemma)), [graph.nodes]);

  useEffect(() => {
    if (!selected) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setData(null);
    fetch(`/api/word/${encodeURIComponent(selected)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WordResponse | null) => alive && setData(d))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [selected]);

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#05060f] shadow-[0_0_80px_rgba(56,189,248,0.08)_inset]">
      <WordGalaxy graph={graph} selected={selected} onSelect={setSelected} />

      <GalaxySearch nodes={graph.nodes} onPick={setSelected} />

      {/* Legend */}
      <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-2 text-[11px] text-slate-400">
        <Legend swatch="#7dd3fc" label="core word" />
        <Legend swatch="#c4b5fd" label="advanced" />
        <Legend swatch="#fde68a" label="hub" />
        <Legend swatch="#cbd5e1" label="unconnected" />
        <span className="rounded-full bg-white/5 px-2 py-1">
          {graph.nodes.length} stars · {graph.edges.length} links
          {graph.isolatedCount > 0 ? ` · ${graph.isolatedCount} unconnected` : ""}
        </span>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 text-[11px] text-slate-500">
        drag to orbit · scroll to zoom · click a star
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="absolute right-0 top-0 h-full w-full border-l border-white/10 bg-[#0a0d1aee] backdrop-blur-md sm:w-[400px]">
          {data ? (
            <WordDetailPanel
              page={data.page}
              detail={data.detail}
              nodeIds={nodeIds}
              onSelect={(lemma) => setSelected(lemma)}
              onClose={() => setSelected(null)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              {loading ? "Loading word…" : "Word not found."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GalaxySearch({
  nodes,
  onPick,
}: {
  nodes: GraphNode[];
  onPick: (lemma: string) => void;
}) {
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const exact: GraphNode[] = [];
    const starts: GraphNode[] = [];
    const contains: GraphNode[] = [];
    for (const n of nodes) {
      const d = n.display.toLowerCase();
      if (d === query) exact.push(n);
      else if (d.startsWith(query)) starts.push(n);
      else if (d.includes(query)) contains.push(n);
    }
    return [...exact, ...starts, ...contains].slice(0, 8);
  }, [q, nodes]);

  const pick = (lemma: string) => {
    onPick(lemma);
    setQ("");
    setFocused(false);
  };

  return (
    <div className="absolute left-1/2 top-4 z-20 w-[min(90vw,320px)] -translate-x-1/2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) pick(results[0].lemma);
          if (e.key === "Escape") setQ("");
        }}
        placeholder="🔍  Search for a word…"
        className="w-full rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-slate-100 placeholder:text-slate-400 outline-none backdrop-blur-md focus:border-sky-400/60"
      />
      {focused && results.length > 0 && (
        <ul className="mt-2 max-h-72 overflow-y-auto rounded-2xl border border-white/10 bg-[#0a0d1a]/95 p-1 backdrop-blur-md">
          {results.map((n) => (
            <li key={n.lemma}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(n.lemma)}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/10"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{
                      background:
                        n.tier === "advanced" ? "#c4b5fd" : n.degree === 0 ? "#cbd5e1" : "#7dd3fc",
                    }}
                  />
                  {n.display}
                </span>
                <span className="text-[11px] text-slate-500">{n.pos}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {focused && q.trim() && results.length === 0 && (
        <div className="mt-2 rounded-2xl border border-white/10 bg-[#0a0d1a]/95 px-4 py-3 text-sm text-slate-400 backdrop-blur-md">
          No word matches “{q.trim()}” in this galaxy.
        </div>
      )}
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-1">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: swatch, boxShadow: `0 0 6px ${swatch}` }} />
      {label}
    </span>
  );
}
