import { createHash } from "node:crypto";

import { buildListGraph, type GraphEdge, type GraphNode, type WikiPage as RuntimeWikiPage } from "../wiki/parse-wiki";
import type { WikiPage } from "./legacy-markdown";
import type { ContentSourceRef, VocabularyRecord } from "./schema";

const LIST_SLUGS = ["academic", "all", "business", "fitness", "ngsl", "toeic"] as const;
const PLACEHOLDER = /definition pending|needs a fuller dictionary source/i;

export type MigrationParityMismatch = {
  lemma: string;
  field: string;
  legacy: unknown;
  canonical: unknown;
};

export type GraphParityMismatch = Omit<MigrationParityMismatch, "lemma">;

export type GraphParityReport = {
  nodes: { legacy: number; canonical: number };
  edges: { legacy: number; canonical: number };
  isolatedCount: { legacy: number; canonical: number };
  hashes: { legacy: string; canonical: string };
  mismatches: GraphParityMismatch[];
};

export type MigrationAuditMetrics = {
  records: number;
  connections: number;
  duplicateLemmas: string[];
  connectionsByType: Record<string, number>;
  unknownPartOfSpeech: string[];
  placeholders: string[];
  missingExamples: string[];
  sources: Record<string, number>;
  charts: Record<string, number>;
  regions: Record<string, number>;
  contentHash: string;
};

export type MigrationAudit = {
  totals: { legacy: MigrationAuditMetrics; canonical: MigrationAuditMetrics };
  perList: Record<string, { legacy: MigrationAuditMetrics; canonical: MigrationAuditMetrics }>;
};

export type MigrationParityReport = {
  ok: boolean;
  mismatches: MigrationParityMismatch[];
  graphs: Record<(typeof LIST_SLUGS)[number], GraphParityReport>;
  audit: MigrationAudit;
};

type SourceReference = { sourceId: string };
type ProjectedExample = { text: string; sources: string[] };
type ProjectedConnection = {
  target: string;
  type: string;
  gloss: string | null;
  sources: string[];
  status: "unreviewed" | "published" | "hidden";
};
type ProjectedSense = {
  partOfSpeech: string;
  definition: string;
  sources: string[];
  examples: ProjectedExample[];
};
type ProjectedListMembership = { id: string; rank: number | null; sfi: number | null };
type ProjectedPage = {
  lemma: string;
  display: string;
  tier: "core" | "advanced";
  partOfSpeech: string;
  forms: string[];
  lists: ProjectedListMembership[];
  status: string;
  sources: string[];
  senses: ProjectedSense[];
  usageNote: string | null;
  connections: ProjectedConnection[];
  domains: string[];
  chart: string | null;
  region: string | null;
};

type GraphStructure = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  isolatedCount: number;
};

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort(compareOrdinal).map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareOrdinal);
}

function sourceIds(sources: SourceReference[]): string[] {
  return uniqueSorted(sources.map((source) => source.sourceId));
}

function sortBySerialized<T>(values: T[]): T[] {
  return values.toSorted((left, right) => compareOrdinal(stableStringify(left), stableStringify(right)));
}

function projectLegacyPage(page: WikiPage): ProjectedPage {
  const pageSources = uniqueSorted(page.sources);
  return {
    lemma: page.lemma,
    display: page.display,
    tier: page.tier,
    partOfSpeech: page.pos,
    forms: uniqueSorted(page.forms),
    lists: sortBySerialized(uniqueSorted(page.lists).map((id) => ({ id, rank: page.rank, sfi: page.sfi }))),
    status: page.status,
    sources: pageSources,
    senses: [{
      partOfSpeech: page.pos,
      definition: page.definition,
      sources: pageSources,
      examples: sortBySerialized(page.examples.map((example) => ({
        text: example.text,
        sources: uniqueSorted(example.sourceIds.length ? example.sourceIds : page.sources),
      }))),
    }],
    usageNote: page.usageNote,
    connections: sortBySerialized(page.connections.map((connection) => ({
      target: connection.target,
      type: connection.type,
      gloss: connection.gloss ?? null,
      sources: pageSources,
      status: connection.gloss ? "published" : "unreviewed",
    }))),
    domains: uniqueSorted(page.domains),
    chart: page.chart,
    region: page.region,
  };
}

function projectCanonicalRecord(record: VocabularyRecord): ProjectedPage {
  return {
    lemma: record.lemma,
    display: record.display,
    tier: record.tier,
    partOfSpeech: record.partOfSpeech,
    forms: uniqueSorted(record.forms),
    lists: sortBySerialized(record.lists.map((membership) => ({
      id: membership.id,
      rank: membership.rank,
      sfi: membership.sfi,
    }))),
    status: record.status,
    sources: sourceIds(record.sources),
    senses: sortBySerialized(record.senses.map((sense) => ({
      partOfSpeech: sense.partOfSpeech,
      definition: sense.definition,
      sources: sourceIds(sense.sources),
      examples: sortBySerialized(sense.examples.map((example) => ({
        text: example.text,
        sources: sourceIds(example.sources),
      }))),
    }))),
    usageNote: record.usageNote,
    connections: sortBySerialized(record.connections.map((connection) => ({
      target: connection.target,
      type: connection.type,
      gloss: connection.gloss,
      sources: sourceIds(connection.sources),
      status: connection.status,
    }))),
    domains: uniqueSorted(record.domains),
    chart: record.chart,
    region: record.region,
  };
}

function projectionMap(pages: ProjectedPage[]): { byLemma: Map<string, ProjectedPage>; duplicates: string[] } {
  const byLemma = new Map<string, ProjectedPage>();
  const duplicates = new Set<string>();
  for (const page of pages) {
    if (byLemma.has(page.lemma)) duplicates.add(page.lemma);
    else byLemma.set(page.lemma, page);
  }
  return { byLemma, duplicates: [...duplicates].sort(compareOrdinal) };
}

function appendDifferences(
  mismatches: MigrationParityMismatch[],
  lemma: string,
  field: string,
  legacy: unknown,
  canonical: unknown,
): void {
  if (Object.is(legacy, canonical)) return;
  if (Array.isArray(legacy) && Array.isArray(canonical)) {
    for (let index = 0; index < Math.max(legacy.length, canonical.length); index += 1) {
      appendDifferences(mismatches, lemma, `${field}[${index}]`, legacy[index], canonical[index]);
    }
    return;
  }
  if (isPlainObject(legacy) && isPlainObject(canonical)) {
    for (const key of uniqueSorted([...Object.keys(legacy), ...Object.keys(canonical)])) {
      appendDifferences(mismatches, lemma, field ? `${field}.${key}` : key, legacy[key], canonical[key]);
    }
    return;
  }
  mismatches.push({ lemma, field, legacy, canonical });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMismatches(mismatches: MigrationParityMismatch[]): MigrationParityMismatch[] {
  return mismatches.toSorted((left, right) => compareOrdinal(left.lemma, right.lemma) || compareOrdinal(left.field, right.field));
}

function asRuntimePage(page: ProjectedPage): RuntimeWikiPage {
  const membership = page.lists[0];
  return {
    lemma: page.lemma,
    display: page.display,
    tier: page.tier,
    pos: page.partOfSpeech,
    rank: membership?.rank ?? null,
    sfi: membership?.sfi ?? null,
    chart: page.chart,
    region: page.region,
    lists: page.lists.map((entry) => entry.id),
    forms: page.forms,
    status: page.status,
    sources: page.sources,
    definition: page.senses[0]?.definition ?? "",
    usageNote: page.usageNote,
    examples: page.senses.flatMap((sense) => sense.examples.map((example) => example.text)),
    connections: page.connections.map((connection) => ({
      type: connection.type,
      target: connection.target,
      ...(connection.gloss === null ? {} : { gloss: connection.gloss }),
    })),
    domains: page.domains,
  };
}

function graphStructure(pages: ProjectedPage[], slug: string): GraphStructure {
  const graph = buildListGraph(
    pages.toSorted((left, right) => compareOrdinal(left.lemma, right.lemma)).map(asRuntimePage),
    slug,
  );
  return {
    nodes: graph.nodes.toSorted((left, right) => compareOrdinal(left.lemma, right.lemma)),
    edges: graph.edges.map((edge) => {
      const [source, target] = [edge.source, edge.target].sort(compareOrdinal);
      return { source, target, type: edge.type };
    }).toSorted((left, right) => (
      compareOrdinal(left.source, right.source)
      || compareOrdinal(left.target, right.target)
      || compareOrdinal(left.type, right.type)
    )),
    isolatedCount: graph.isolatedCount,
  };
}

function compareGraph(legacy: GraphStructure, canonical: GraphStructure): GraphParityReport {
  const raw: MigrationParityMismatch[] = [];
  appendDifferences(raw, "graph", "nodes", legacy.nodes, canonical.nodes);
  appendDifferences(raw, "graph", "edges", legacy.edges, canonical.edges);
  appendDifferences(raw, "graph", "isolatedCount", legacy.isolatedCount, canonical.isolatedCount);
  const mismatches = raw.map(({ field, legacy: legacyValue, canonical: canonicalValue }) => ({
    field,
    legacy: legacyValue,
    canonical: canonicalValue,
  })).toSorted((left, right) => compareOrdinal(left.field, right.field));
  return {
    nodes: { legacy: legacy.nodes.length, canonical: canonical.nodes.length },
    edges: { legacy: legacy.edges.length, canonical: canonical.edges.length },
    isolatedCount: { legacy: legacy.isolatedCount, canonical: canonical.isolatedCount },
    hashes: { legacy: hash(legacy), canonical: hash(canonical) },
    mismatches,
  };
}

function countBy(values: Iterable<string>): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([left], [right]) => compareOrdinal(left, right)));
}

function auditMetrics(pages: ProjectedPage[], duplicates: string[]): MigrationAuditMetrics {
  return {
    records: pages.length,
    connections: pages.reduce((total, page) => total + page.connections.length, 0),
    duplicateLemmas: duplicates,
    connectionsByType: countBy(pages.flatMap((page) => page.connections.map((connection) => connection.type))),
    unknownPartOfSpeech: pages.filter((page) => page.partOfSpeech.toLowerCase() === "unknown" || !page.partOfSpeech.trim()).map((page) => page.lemma).sort(compareOrdinal),
    placeholders: pages.filter((page) => page.senses.some((sense) => PLACEHOLDER.test(sense.definition) || !sense.definition.trim())).map((page) => page.lemma).sort(compareOrdinal),
    missingExamples: pages.filter((page) => page.senses.flatMap((sense) => sense.examples).length === 0).map((page) => page.lemma).sort(compareOrdinal),
    sources: countBy(pages.flatMap((page) => page.sources)),
    charts: countBy(pages.flatMap((page) => page.chart === null ? [] : [page.chart])),
    regions: countBy(pages.flatMap((page) => page.region === null ? [] : [page.region])),
    contentHash: hash(pages.toSorted((left, right) => compareOrdinal(left.lemma, right.lemma))),
  };
}

function auditCorpus(pages: ProjectedPage[]): { totals: MigrationAuditMetrics; perList: Record<string, MigrationAuditMetrics> } {
  const { duplicates } = projectionMap(pages);
  const listIds = uniqueSorted(["all", ...pages.flatMap((page) => page.lists.map((membership) => membership.id))]);
  return {
    totals: auditMetrics(pages, duplicates),
    perList: Object.fromEntries(listIds.map((id) => {
      const members = id === "all" ? pages : pages.filter((page) => page.lists.some((membership) => membership.id === id));
      return [id, auditMetrics(members, projectionMap(members).duplicates)];
    })),
  };
}

function compareAudit(
  mismatches: MigrationParityMismatch[],
  legacy: ReturnType<typeof auditCorpus>,
  canonical: ReturnType<typeof auditCorpus>,
): MigrationAudit {
  appendDifferences(mismatches, "(corpus)", "audit.totals", legacy.totals, canonical.totals);
  for (const list of uniqueSorted([...Object.keys(legacy.perList), ...Object.keys(canonical.perList)])) {
    appendDifferences(mismatches, "(corpus)", `audit.perList.${list}`, legacy.perList[list], canonical.perList[list]);
  }
  return {
    totals: { legacy: legacy.totals, canonical: canonical.totals },
    perList: Object.fromEntries(uniqueSorted([...Object.keys(legacy.perList), ...Object.keys(canonical.perList)]).map((list) => [list, {
      legacy: legacy.perList[list] ?? auditMetrics([], []),
      canonical: canonical.perList[list] ?? auditMetrics([], []),
    }])),
  };
}

/** Compares the migration source and canonical NDJSON records without mutating either corpus. */
export function compareLegacyAndCanonical(legacy: WikiPage[], canonical: VocabularyRecord[]): MigrationParityReport {
  const legacyPages = legacy.map(projectLegacyPage);
  const canonicalPages = canonical.map(projectCanonicalRecord);
  const legacyByLemma = projectionMap(legacyPages).byLemma;
  const canonicalByLemma = projectionMap(canonicalPages).byLemma;
  const mismatches: MigrationParityMismatch[] = [];

  for (const lemma of uniqueSorted([...legacyByLemma.keys(), ...canonicalByLemma.keys()])) {
    appendDifferences(mismatches, lemma, "", legacyByLemma.get(lemma), canonicalByLemma.get(lemma));
  }

  const audit = compareAudit(mismatches, auditCorpus(legacyPages), auditCorpus(canonicalPages));
  const graphs = Object.fromEntries(LIST_SLUGS.map((slug) => [slug, compareGraph(
    graphStructure(legacyPages, slug),
    graphStructure(canonicalPages, slug),
  )])) as MigrationParityReport["graphs"];
  const ordered = normalizeMismatches(mismatches);
  const graphOk = Object.values(graphs).every((graph) => graph.mismatches.length === 0);

  return { ok: ordered.length === 0 && graphOk, mismatches: ordered, graphs, audit };
}

/** Raises a deterministic, concise error for CI and the migration CLI. */
export function assertMigrationParity(report: MigrationParityReport): void {
  if (report.ok) return;
  const firstFieldMismatch = report.mismatches[0];
  if (firstFieldMismatch) {
    throw new Error(`Vocabulary migration parity failed at ${firstFieldMismatch.lemma}.${firstFieldMismatch.field}`);
  }
  const firstGraph = LIST_SLUGS.map((slug) => [slug, report.graphs[slug]] as const).find(([, graph]) => graph.mismatches.length > 0);
  if (firstGraph) throw new Error(`Vocabulary migration graph parity failed at ${firstGraph[0]}.${firstGraph[1].mismatches[0]!.field}`);
  throw new Error("Vocabulary migration parity failed");
}
