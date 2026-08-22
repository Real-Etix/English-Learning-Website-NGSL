import { louvain } from "../wiki/louvain";
import type { GraphInput } from "./graph-input";

export type GraphNode = {
  lemma: string;
  display: string;
  tier: "core" | "advanced";
  pos: string;
  rank: number | null;
  chart: string | null;
  degree: number;
};

export type GraphEdge = { source: string; target: string; type: string };

export type ListGraph = {
  slug: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  pages: Record<string, GraphInput>;
  isolatedCount: number;
};

/** The client only needs nodes + edges to draw the galaxy; word detail loads separately. */
export type LiteGraph = {
  slug: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  isolatedCount: number;
  chartNames?: Record<string, string>;
};

export function toLiteGraph(graph: ListGraph): LiteGraph {
  return {
    slug: graph.slug,
    nodes: graph.nodes,
    edges: graph.edges,
    isolatedCount: graph.isolatedCount,
  };
}

function compareLemma(left: GraphInput, right: GraphInput): number {
  // The legacy reader sorted Markdown filenames, not bare lemmas. Appending the
  // extension preserves its ordering around hyphenated lemmas ("also-ran.md"
  // precedes "also.md"), which seeds Louvain identically to the old builder.
  const leftFile = `${left.lemma}.md`;
  const rightFile = `${right.lemma}.md`;
  return leftFile < rightFile ? -1 : leftFile > rightFile ? 1 : 0;
}

function membershipFor(page: GraphInput, slug: string): { rank: number | null; sfi: number | null } {
  if (slug === "all") return page.memberships[0] ?? { rank: null, sfi: null };
  return page.memberships.find((membership) => membership.id === slug) ?? page.memberships[0] ?? { rank: null, sfi: null };
}

/**
 * Builds one list's graph. Core list membership remains pure; the only external
 * inclusions are advanced learning targets and core bridges linked by two list
 * words, preserving the existing galaxy contract.
 */
export function buildListGraph(inputs: GraphInput[], slug: string): ListGraph {
  const pages = [...inputs].sort(compareLemma);
  const inList = (page: GraphInput) => slug === "all" || page.memberships.some((membership) => membership.id === slug);
  const byLemma = new Map(pages.map((page) => [page.lemma, page]));
  const listPages = pages.filter(inList);
  const included = new Set(listPages.map((page) => page.lemma));
  const linkers = new Map<string, Set<string>>();

  for (const page of listPages) {
    for (const connection of page.connections) {
      const target = byLemma.get(connection.target);
      if (!target || included.has(connection.target)) continue;
      if (target.tier === "advanced") {
        included.add(connection.target);
        continue;
      }
      const from = linkers.get(connection.target) ?? new Set<string>();
      from.add(page.lemma);
      linkers.set(connection.target, from);
    }
  }
  for (const [target, from] of linkers) if (from.size >= 2) included.add(target);

  return assembleGraph(pages, included, slug);
}

const EDGE_WEIGHT: Record<string, number> = {
  synonym: 1.6,
  antonym: 1.3,
  morphological: 1.2,
  advanced_form: 1,
  builds_on: 1,
  intensity: 1,
  collocation: 0.9,
};
const MIN_CHART = 5;

function clusterCharts(
  nodeIds: string[],
  edges: GraphEdge[],
  degree: Map<string, number>,
  rankOf: Map<string, number | null>,
): Map<string, string> {
  // Keep legacy Markdown filename order through Louvain and all ties so existing
  // chart assignments and their themed hub IDs remain stable.
  const connected = nodeIds.filter((id) => (degree.get(id) ?? 0) > 0);
  const weightedEdges = edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    weight: EDGE_WEIGHT[edge.type] ?? 1,
  }));
  const community = louvain(connected, weightedEdges, { resolution: 1 });
  const between = new Map<string, number>();
  const communityOf = new Map(connected.map((id) => [id, community.get(id)!]));

  for (const edge of edges) {
    const sourceCommunity = communityOf.get(edge.source);
    const targetCommunity = communityOf.get(edge.target);
    if (sourceCommunity === undefined || targetCommunity === undefined || sourceCommunity === targetCommunity) continue;
    const key = sourceCommunity < targetCommunity
      ? `${sourceCommunity}|${targetCommunity}`
      : `${targetCommunity}|${sourceCommunity}`;
    between.set(key, (between.get(key) ?? 0) + (EDGE_WEIGHT[edge.type] ?? 1));
  }

  const merged = new Map<number, number>();
  const resolve = (value: number): number => {
    let current = value;
    while (merged.has(current)) current = merged.get(current)!;
    return current;
  };
  const frozen = new Set<number>();
  for (let guard = 0; guard < connected.length * 2; guard += 1) {
    const sizes = new Map<number, number>();
    for (const id of connected) {
      const current = resolve(community.get(id)!);
      sizes.set(current, (sizes.get(current) ?? 0) + 1);
    }
    let small: number | null = null;
    let smallSize = Infinity;
    for (const [id, size] of sizes) {
      if (!frozen.has(id) && size < MIN_CHART && size < smallSize) {
        small = id;
        smallSize = size;
      }
    }
    if (small === null) break;

    let target: number | undefined;
    let bestWeight = -1;
    for (const [key, weight] of between) {
      const [left, right] = key.split("|").map(Number);
      const resolvedLeft = resolve(left);
      const resolvedRight = resolve(right);
      const candidate: number | undefined = resolvedLeft === small ? resolvedRight : resolvedRight === small ? resolvedLeft : undefined;
      if (candidate !== undefined && candidate !== small && weight > bestWeight) {
        target = candidate;
        bestWeight = weight;
      }
    }
    if (target === undefined) frozen.add(small);
    else merged.set(small, target);
  }

  const members = new Map<number, string[]>();
  for (const id of connected) {
    const resolved = resolve(community.get(id)!);
    const group = members.get(resolved) ?? [];
    group.push(id);
    members.set(resolved, group);
  }
  const chartOf = new Map<string, string>();
  for (const group of members.values()) {
    if (group.length < MIN_CHART) continue;
    const hub = [...group].sort((left, right) => {
      const degreeDifference = (degree.get(right) ?? 0) - (degree.get(left) ?? 0);
      if (degreeDifference !== 0) return degreeDifference;
      const rankDifference = (rankOf.get(left) ?? Infinity) - (rankOf.get(right) ?? Infinity);
      return rankDifference;
    })[0]!;
    for (const id of group) chartOf.set(id, hub);
  }
  return chartOf;
}

function assembleGraph(inputs: GraphInput[], includedSet: Set<string>, slug: string): ListGraph {
  const included = inputs.filter((page) => includedSet.has(page.lemma));
  const nodeSet = new Set(included.map((page) => page.lemma));
  const pages = Object.fromEntries(included.map((page) => [page.lemma, page]));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const degree = new Map<string, number>();

  for (const page of included) {
    for (const connection of page.connections) {
      if (!nodeSet.has(connection.target)) continue;
      const [left, right] = [page.lemma, connection.target].sort();
      const key = `${left}|${right}|${connection.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: page.lemma, target: connection.target, type: connection.type });
      degree.set(page.lemma, (degree.get(page.lemma) ?? 0) + 1);
      degree.set(connection.target, (degree.get(connection.target) ?? 0) + 1);
    }
  }

  const rankOf = new Map(included.map((page) => [page.lemma, membershipFor(page, slug).rank]));
  const chartOf = clusterCharts([...nodeSet], edges, degree, rankOf);
  const nodes = included.map((page) => ({
    lemma: page.lemma,
    display: page.display,
    tier: page.tier,
    pos: page.partOfSpeech,
    rank: membershipFor(page, slug).rank,
    chart: chartOf.get(page.lemma) ?? "drift",
    degree: degree.get(page.lemma) ?? 0,
  }));

  return {
    slug,
    nodes,
    edges,
    pages,
    isolatedCount: nodes.filter((node) => node.degree === 0).length,
  };
}

/** A learner's collected words rendered as their own galaxy. */
export function buildCollectionGraph(inputs: GraphInput[], lemmas: Set<string>): ListGraph {
  return assembleGraph([...inputs].sort(compareLemma), lemmas, "collection");
}
