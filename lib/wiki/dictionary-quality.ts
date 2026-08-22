import type { WikiPage } from "./parse-wiki";

export type DictionaryEvidenceCounts = {
  verified: number;
  sourceBacked: number;
  aiDraft: number;
};

export type DictionaryEdgeCounts = {
  total: number;
  unexplained: number;
  byType: Record<string, { total: number; unexplained: number }>;
};

export type DictionaryQualityCounts = {
  pages: number;
  placeholders: number;
  noExamples: number;
  unknownPartOfSpeech: number;
  llmOnlyAdvanced: number;
  zeroConnections: number;
  evidence: DictionaryEvidenceCounts;
  edges: DictionaryEdgeCounts;
};

export type DictionaryQualityReport = {
  total: DictionaryQualityCounts;
  lists: Record<string, DictionaryQualityCounts>;
};

const FACTUAL_SOURCES = new Set(["curated", "wordnet", "dictionaryapi", "tatoeba"]);

const isPlaceholder = (value: string) =>
  /definition pending|needs a fuller dictionary source/i.test(value);

function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function emptyCounts(): DictionaryQualityCounts {
  return {
    pages: 0,
    placeholders: 0,
    noExamples: 0,
    unknownPartOfSpeech: 0,
    llmOnlyAdvanced: 0,
    zeroConnections: 0,
    evidence: { verified: 0, sourceBacked: 0, aiDraft: 0 },
    edges: { total: 0, unexplained: 0, byType: emptyRecord() },
  };
}

function evidenceFor(page: WikiPage): keyof DictionaryEvidenceCounts {
  if (page.status === "verified") return "verified";
  if (page.sources.some((source) => FACTUAL_SOURCES.has(source))) return "sourceBacked";
  return "aiDraft";
}

function isLlmOnlyAdvanced(page: WikiPage): boolean {
  return page.tier === "advanced" && page.sources.length > 0 && page.sources.every((source) => source === "llm");
}

function addPage(counts: DictionaryQualityCounts, page: WikiPage) {
  counts.pages += 1;
  if (!page.definition.trim() || isPlaceholder(page.definition)) counts.placeholders += 1;
  if (page.examples.length === 0) counts.noExamples += 1;
  if (!page.pos.trim() || page.pos.trim().toLowerCase() === "unknown") counts.unknownPartOfSpeech += 1;
  if (isLlmOnlyAdvanced(page)) counts.llmOnlyAdvanced += 1;
  if (page.connections.length === 0) counts.zeroConnections += 1;
  counts.evidence[evidenceFor(page)] += 1;

  for (const connection of page.connections) {
    const edge = counts.edges.byType[connection.type] ?? { total: 0, unexplained: 0 };
    counts.edges.byType[connection.type] = edge;
    counts.edges.total += 1;
    edge.total += 1;
    if (!connection.gloss?.trim()) {
      counts.edges.unexplained += 1;
      edge.unexplained += 1;
    }
  }
}

/** Aggregate dictionary-quality signals without mutating wiki pages. */
export function auditDictionaryPages(pages: WikiPage[]): DictionaryQualityReport {
  const report: DictionaryQualityReport = { total: emptyCounts(), lists: emptyRecord() };

  for (const page of pages) {
    addPage(report.total, page);
    for (const list of new Set(page.lists)) {
      report.lists[list] ??= emptyCounts();
      addPage(report.lists[list], page);
    }
  }

  return report;
}

export function hasStrictFailures(report: DictionaryQualityReport): boolean {
  return report.total.placeholders > 0 || report.total.llmOnlyAdvanced > 0;
}
