import type { LiteGraph } from "@/lib/vocabulary/graph";

export type RunStop = { lemma: string; display: string; chartId: string };

export type LadderRung = {
  from: string;
  fromDisplay: string;
  fromChartId: string;
  to: string;
  toDisplay: string;
  toChartId: string;
  baseHeld: boolean;
  type: "advanced_form" | "builds_on";
};

const LEARNING_ROUTE_LISTS = new Set(["ngsl", "toeic", "business", "academic", "fitness", "all"]);

type RouteCandidate = LadderRung & { targetAdvanced: boolean; targetDegree: number };

const compareOrdinal = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function hash(value: string) {
  let hashValue = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hashValue ^= value.charCodeAt(index);
    hashValue = Math.imul(hashValue, 16777619);
  }
  return hashValue >>> 0;
}

function rng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function isLearningRouteList(slug: string): boolean {
  return LEARNING_ROUTE_LISTS.has(slug);
}

export function getLearningRouteList(request: Request): string | null {
  const requestedList = new URL(request.url).searchParams.get("list");
  const list = requestedList === null ? "ngsl" : requestedList;
  return isLearningRouteList(list) ? list : null;
}

export function buildRunStops(graph: LiteGraph, day: string, limit: number): RunStop[] {
  if (limit <= 0) return [];

  const byChart = new Map<string, RunStop[]>();
  for (const node of graph.nodes) {
    if (!node.chart || node.chart === "drift" || node.degree <= 0) continue;
    const stops = byChart.get(node.chart) ?? [];
    stops.push({ lemma: node.lemma, display: node.display, chartId: node.chart });
    byChart.set(node.chart, stops);
  }

  const random = rng(hash(`run${day}${graph.slug}`));
  const chartIds = [...byChart.keys()]
    .sort((left, right) => byChart.get(right)!.length - byChart.get(left)!.length)
    .sort(() => random() - 0.5);

  const stops: RunStop[] = [];
  for (const chartId of chartIds) {
    const pool = byChart.get(chartId)!;
    stops.push(pool[Math.floor(random() * pool.length)]);
    if (stops.length >= limit) break;
  }
  return stops;
}

export function buildLadderRungs(graph: LiteGraph, ownedLemmas: Set<string>, limit: number): LadderRung[] {
  if (limit <= 0) return [];

  const nodes = new Map(graph.nodes.map((node) => [node.lemma, node]));
  const candidates: RouteCandidate[] = [];

  for (const edge of graph.edges) {
    if (edge.type !== "advanced_form" && edge.type !== "builds_on") continue;
    const [fromLemma, toLemma] = edge.type === "advanced_form"
      ? [edge.source, edge.target]
      : [edge.target, edge.source];
    const from = nodes.get(fromLemma);
    const to = nodes.get(toLemma);
    if (!from || !to || ownedLemmas.has(to.lemma)) continue;

    candidates.push({
      from: from.lemma,
      fromDisplay: from.display,
      fromChartId: from.chart ?? "drift",
      to: to.lemma,
      toDisplay: to.display,
      toChartId: to.chart ?? "drift",
      baseHeld: ownedLemmas.has(from.lemma),
      type: edge.type,
      targetAdvanced: to.tier === "advanced",
      targetDegree: to.degree,
    });
  }

  candidates.sort((left, right) =>
    Number(right.baseHeld) - Number(left.baseHeld)
    || Number(right.targetAdvanced) - Number(left.targetAdvanced)
    || right.targetDegree - left.targetDegree
    || compareOrdinal(left.to, right.to)
    || compareOrdinal(left.from, right.from)
    || compareOrdinal(left.type, right.type),
  );

  const seenTargets = new Set<string>();
  const rungs: LadderRung[] = [];
  for (const candidate of candidates) {
    if (seenTargets.has(candidate.to)) continue;
    seenTargets.add(candidate.to);
    rungs.push({
      from: candidate.from,
      fromDisplay: candidate.fromDisplay,
      fromChartId: candidate.fromChartId,
      to: candidate.to,
      toDisplay: candidate.toDisplay,
      toChartId: candidate.toChartId,
      baseHeld: candidate.baseHeld,
      type: candidate.type,
    });
    if (rungs.length >= limit) break;
  }
  return rungs;
}
