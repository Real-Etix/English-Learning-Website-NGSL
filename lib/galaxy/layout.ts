import type { LiteGraph } from "@/lib/wiki/parse-wiki";
import type { ChartLink, PositionedGalaxy, PositionedWord, Vec3 } from "./types";

const GLYPHS = ["≈", "|", "⌐", "∧", "✦", "◦", "◇", "○", "▲", "↑", "◆", "✳", "⌕", "∴", "⋄", "✧"];
const HUES = ["#9FD4E8", "#E8C79F", "#C9B8E8", "#A8DCC0", "#E8A89F", "#E8DFA0", "#9FC4E8", "#D6BFE8"];
const GOLDEN_ANGLE = 2.39996;
const GALAXY_RADIUS = 470;

export function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const normalize = ([x, y, z]: Vec3): Vec3 => {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function layoutGalaxy(graph: LiteGraph, label: string): PositionedGalaxy {
  const groups = new Map<string, typeof graph.nodes>();
  for (const node of graph.nodes) {
    const chartId = node.chart || "drift";
    groups.set(chartId, [...(groups.get(chartId) || []), node]);
  }
  const chartIds = [...groups.keys()].sort((a, b) => {
    if (a === "drift") return 1;
    if (b === "drift") return -1;
    return (groups.get(b)?.length || 0) - (groups.get(a)?.length || 0) || a.localeCompare(b);
  });
  const centers = new Map<string, Vec3>();
  const charts = chartIds.map((id, index) => {
    const y = 1 - (index / Math.max(1, chartIds.length - 1)) * 1.55 - 0.22;
    const radial = Math.sqrt(Math.max(0.02, 1 - y * y));
    const theta = index * GOLDEN_ANGLE;
    const center: Vec3 = [Math.cos(theta) * radial * GALAXY_RADIUS, y * 0.72 * GALAXY_RADIUS, Math.sin(theta) * radial * GALAXY_RADIUS];
    centers.set(id, center);
    const seed = hashSeed(`${graph.slug}:${id}`);
    return {
      id,
      name: id === "drift" ? "Drift" : graph.chartNames?.[id] || titleCase(id),
      glyph: GLYPHS[seed % GLYPHS.length],
      hue: HUES[seed % HUES.length],
      wordCount: groups.get(id)?.length || 0,
      center,
      radius: id === "drift" ? GALAXY_RADIUS * 1.2 : 156,
      previewSeed: seed,
      neighbors: [] as { chartId: string; weight: number }[],
    };
  });
  const words: PositionedWord[] = [];
  for (const chartId of chartIds) {
    const members = [...(groups.get(chartId) || [])].sort((a, b) => b.degree - a.degree || a.lemma.localeCompare(b.lemma));
    const rnd = random(hashSeed(`${graph.slug}:${chartId}:words`));
    const center = centers.get(chartId) as Vec3;
    const axis = normalize(center);
    let u = normalize(cross([0, 1, 0], axis));
    if (Math.hypot(...u) < 0.01) u = [1, 0, 0];
    const v = normalize(cross(axis, u));
    members.forEach((node, index) => {
      let xyz: Vec3;
      if (chartId === "drift") {
        const driftY = rnd() * 2 - 1;
        const driftR = Math.sqrt(Math.max(0, 1 - driftY * driftY));
        const angle = rnd() * Math.PI * 2;
        const radius = GALAXY_RADIUS * (1.02 + (rnd() - 0.5) * 0.34);
        xyz = [Math.cos(angle) * driftR * radius, driftY * 0.72 * radius, Math.sin(angle) * driftR * radius];
      } else {
        const t = (index + 0.5) / Math.max(1, members.length);
        const radius = 34 + Math.sqrt(t) * 122;
        const angle = index * GOLDEN_ANGLE + rnd() * 0.35;
        const lift = (rnd() - 0.5) * 62;
        xyz = [
          center[0] + u[0] * Math.cos(angle) * radius + v[0] * Math.sin(angle) * radius + axis[0] * lift,
          center[1] + u[1] * Math.cos(angle) * radius + v[1] * Math.sin(angle) * radius + axis[1] * lift,
          center[2] + u[2] * Math.cos(angle) * radius + v[2] * Math.sin(angle) * radius + axis[2] * lift,
        ];
      }
      words.push({
        lemma: node.lemma,
        display: node.display,
        tier: node.tier,
        partOfSpeech: node.pos,
        rank: node.rank,
        degree: node.degree,
        chartId,
        xyz,
      });
    });
  }
  const chartOf = new Map(words.map((word) => [word.lemma, word.chartId]));
  const weights = new Map<string, number>();
  for (const edge of graph.edges) {
    const a = chartOf.get(edge.source);
    const b = chartOf.get(edge.target);
    if (!a || !b || a === b) continue;
    const [sourceChart, targetChart] = [a, b].sort();
    const key = `${sourceChart}\u0000${targetChart}`;
    weights.set(key, (weights.get(key) || 0) + 1);
  }
  const chartLinks: ChartLink[] = [...weights].map(([key, weight]) => {
    const [sourceChart, targetChart] = key.split("\u0000");
    return { sourceChart, targetChart, weight };
  }).sort((a, b) => b.weight - a.weight || a.sourceChart.localeCompare(b.sourceChart));
  for (const chart of charts) {
    chart.neighbors = chartLinks
      .filter((link) => link.sourceChart === chart.id || link.targetChart === chart.id)
      .map((link) => ({ chartId: link.sourceChart === chart.id ? link.targetChart : link.sourceChart, weight: link.weight }))
      .sort((a, b) => b.weight - a.weight || a.chartId.localeCompare(b.chartId))
      .slice(0, 8);
  }
  return { listSlug: graph.slug, label, charts, words, edges: graph.edges, chartLinks };
}
