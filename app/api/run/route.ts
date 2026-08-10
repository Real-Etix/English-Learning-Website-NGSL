import { loadListGraph } from "@/lib/wiki/graph-store";

export const runtime = "nodejs";

// Deterministic PRNG, seeded per (day, list) — matches the client's fallback.
function hash(str: string) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/**
 * Tonight's run, generated server-side from the local date so the route is
 * authoritative (a client can't reshuffle to cherry-pick easy words). One star
 * per chart, biggest charts first, up to 8. Falls back to client generation on
 * error, so the run always works.
 */
export async function GET(request: Request) {
  const list = new URL(request.url).searchParams.get("list") || "ngsl";
  const graph = await loadListGraph(list);

  const byChart = new Map<string, { lemma: string; degree: number }[]>();
  for (const n of graph.nodes) {
    if (!n.chart || n.chart === "drift" || n.degree <= 0) continue;
    (byChart.get(n.chart) ?? byChart.set(n.chart, []).get(n.chart)!).push({ lemma: n.lemma, degree: n.degree });
  }

  const day = new Date().toISOString().slice(0, 10);
  const r = rng(hash("run" + day + list));
  // biggest charts first (stable), then a seeded shuffle — same recipe as the client
  const order = [...byChart.keys()].sort((a, b) => (byChart.get(b)!.length - byChart.get(a)!.length)).sort(() => r() - 0.5);
  const route: string[] = [];
  for (const id of order) {
    const pool = byChart.get(id)!;
    if (!pool.length) continue;
    route.push(pool[Math.floor(r() * pool.length)].lemma);
    if (route.length >= 8) break;
  }
  return Response.json({ route, day });
}
