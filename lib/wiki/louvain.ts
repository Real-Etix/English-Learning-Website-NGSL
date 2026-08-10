/**
 * Louvain community detection — modularity maximisation over an undirected,
 * weighted graph. Replaces the label-propagation heuristic: it optimises a
 * global quality score (how much denser links are inside groups than chance),
 * so it yields a handful of balanced communities instead of hundreds of
 * fragments, and a `resolution` knob tunes how many.
 *
 * Deterministic: nodes are processed in a fixed order with a seeded shuffle, so
 * the same graph always produces the same partition (reproducible builds).
 */

export type LouvainEdge = { source: string; target: string; weight?: number };

type Graph = {
  /** adjacency: node index → array of [neighbourIndex, weight] */
  adj: Array<Array<[number, number]>>;
  /** self-loop weight per node (from aggregation) */
  selfLoop: number[];
  /** weighted degree per node (incident weight; self-loops counted twice) */
  degree: number[];
  /** total edge weight m (so 2m = sum of degrees) */
  m: number;
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One level of local moving; mutates `comm`, returns whether anything improved. */
function oneLevel(g: Graph, comm: number[], resolution: number, rng: () => number): boolean {
  const n = g.adj.length;
  // sigmaTot[c] = sum of weighted degrees of nodes currently in community c
  const sigmaTot = new Float64Array(n);
  for (let i = 0; i < n; i++) sigmaTot[comm[i]] += g.degree[i];

  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const twoM = 2 * g.m || 1;
  let improvedAny = false;
  let moved = true;
  let guard = 0;
  while (moved && guard++ < 40) {
    moved = false;
    for (const i of order) {
      const ci = comm[i];
      // weight from i into each neighbouring community
      const wTo = new Map<number, number>();
      for (const [nb, w] of g.adj[i]) {
        if (nb === i) continue;
        const c = comm[nb];
        wTo.set(c, (wTo.get(c) ?? 0) + w);
      }
      // remove i from its community
      sigmaTot[ci] -= g.degree[i];
      const wToOld = wTo.get(ci) ?? 0;

      let bestC = ci;
      let bestGain = wToOld - (resolution * sigmaTot[ci] * g.degree[i]) / twoM;
      for (const [c, wic] of wTo) {
        if (c === ci) continue;
        const gain = wic - (resolution * sigmaTot[c] * g.degree[i]) / twoM;
        if (gain > bestGain + 1e-12) { bestGain = gain; bestC = c; }
      }
      sigmaTot[bestC] += g.degree[i];
      if (bestC !== ci) { comm[i] = bestC; moved = true; improvedAny = true; }
    }
  }
  return improvedAny;
}

/** Collapse each community into a super-node; returns the aggregated graph + the community list per super-node. */
function aggregate(g: Graph, comm: number[]): { graph: Graph; renumber: number[] } {
  // renumber communities to 0..k-1
  const map = new Map<number, number>();
  const renumber = comm.map((c) => {
    let id = map.get(c);
    if (id === undefined) { id = map.size; map.set(c, id); }
    return id;
  });
  const k = map.size;
  const selfLoop = new Float64Array(k);
  const between = Array.from({ length: k }, () => new Map<number, number>());
  for (let i = 0; i < g.adj.length; i++) {
    const ci = renumber[i];
    selfLoop[ci] += g.selfLoop[i];
    for (const [nb, w] of g.adj[i]) {
      const cj = renumber[nb];
      if (ci === cj) { if (nb >= i) selfLoop[ci] += w; } // count each intra edge once (i<nb) + i===nb handled above
      else between[ci].set(cj, (between[ci].get(cj) ?? 0) + w);
    }
  }
  const adj: Array<Array<[number, number]>> = Array.from({ length: k }, () => []);
  const degree = new Float64Array(k);
  for (let c = 0; c < k; c++) {
    for (const [d, w] of between[c]) adj[c].push([d, w]);
    // weighted degree = incident weights + 2*self-loop
    let deg = 2 * selfLoop[c];
    for (const [, w] of between[c]) deg += w;
    degree[c] = deg;
  }
  return {
    graph: { adj, selfLoop: Array.from(selfLoop), degree: Array.from(degree), m: g.m },
    renumber,
  };
}

/**
 * Partition `nodes` into communities. Returns a Map from node id → community
 * index (0-based, arbitrary but stable). Isolated nodes (no edges) each land in
 * their own singleton community.
 */
export function louvain(
  nodes: string[],
  edges: LouvainEdge[],
  opts: { resolution?: number; seed?: number } = {},
): Map<string, number> {
  const resolution = opts.resolution ?? 1;
  const rng = mulberry32(opts.seed ?? 0x5ea1);
  const index = new Map<string, number>();
  nodes.forEach((id, i) => index.set(id, i));
  const n = nodes.length;

  const adj: Array<Array<[number, number]>> = Array.from({ length: n }, () => []);
  const degree = new Float64Array(n);
  let m = 0;
  for (const e of edges) {
    const a = index.get(e.source), b = index.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const w = e.weight ?? 1;
    adj[a].push([b, w]);
    adj[b].push([a, w]);
    degree[a] += w; degree[b] += w;
    m += w;
  }

  let g: Graph = { adj, selfLoop: new Array(n).fill(0), degree: Array.from(degree), m };
  // community assignment in the ORIGINAL node space, updated each level
  let node2comm = Array.from({ length: n }, (_, i) => i);

  for (let level = 0; level < 30; level++) {
    const comm = Array.from({ length: g.adj.length }, (_, i) => i);
    const improved = oneLevel(g, comm, resolution, rng);
    if (!improved) break; // no move raised modularity → converged
    // fold this level's community of each super-node back onto original nodes
    const { graph, renumber } = aggregate(g, comm);
    node2comm = node2comm.map((c) => renumber[c]);
    g = graph;
    if (g.adj.length <= 1) break;
  }

  const out = new Map<string, number>();
  nodes.forEach((id, i) => out.set(id, node2comm[i]));
  return out;
}
