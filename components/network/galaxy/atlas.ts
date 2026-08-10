import type { LiteGraph } from "@/lib/wiki/parse-wiki";

/** The data shape the star engine consumes (was `window.ATLAS` in the prototype). */
export type AtlasWord = {
  lemma: string;
  display: string;
  tier: "core" | "advanced";
  pos: string;
  rank: number | null;
  chart: string;
  degree: number;
};
export type AtlasChart = { id: string; name: string; glyph: string; hue: string; blurb: string };
export type AtlasEdge = { source: string; target: string; type: string };
export type AtlasNeighbor = { lemma: string; type: string };
export type AtlasData = {
  charts: AtlasChart[];
  words: AtlasWord[];
  edges: AtlasEdge[];
  adj: Record<string, AtlasNeighbor[]>;
};

// Instrument-marking glyphs + calm hues, chosen deterministically per chart.
const GLYPHS = ["≈", "|", "⌐", "∧", "✦", "◦", "◇", "○", "▲", "↑", "◆", "✳", "⌕", "∴", "⋄", "✧"];
const HUES = ["#9FD4E8", "#E8C79F", "#C9B8E8", "#A8DCC0", "#E8A89F", "#E8DFA0", "#9FC4E8", "#D6BFE8"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Build the engine's atlas from a list's lite graph (charts come from frontmatter). */
export function toAtlas(graph: LiteGraph): AtlasData {
  const words: AtlasWord[] = graph.nodes.map((n) => ({
    lemma: n.lemma,
    display: n.display,
    tier: n.tier,
    pos: n.pos,
    rank: n.rank,
    chart: n.chart ?? "drift",
    degree: n.degree,
  }));

  // A short human blurb per chart — the hub word and how many stars orbit it.
  const chartSizes = new Map<string, number>();
  for (const w of words) chartSizes.set(w.chart, (chartSizes.get(w.chart) ?? 0) + 1);
  const themed = graph.chartNames ?? {};
  const charts: AtlasChart[] = [...new Set(words.map((w) => w.chart))].map((id) => ({
    id,
    name: id === "drift" ? "Drift" : themed[id] || titleCase(id),
    glyph: GLYPHS[hash(id) % GLYPHS.length],
    hue: HUES[hash(id) % HUES.length],
    blurb:
      id === "drift"
        ? "Unconnected stars — words that haven't found their neighbours yet."
        : `Words that orbit “${titleCase(id)}” — ${chartSizes.get(id) ?? 0} stars linked by meaning.`,
  }));

  const edges: AtlasEdge[] = graph.edges.map((e) => ({ source: e.source, target: e.target, type: e.type }));

  // Prototype-less: some lemmas are reserved property names ("constructor",
  // "toString", …) that would otherwise resolve to Object.prototype members.
  const adj: Record<string, AtlasNeighbor[]> = Object.create(null);
  for (const e of edges) {
    (adj[e.source] ??= []).push({ lemma: e.target, type: e.type });
    (adj[e.target] ??= []).push({ lemma: e.source, type: e.type });
  }

  return { charts, words, edges, adj };
}
