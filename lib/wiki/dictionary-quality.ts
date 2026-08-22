import type { VocabularyRecord } from "../vocabulary/schema";
import { evidenceForSources } from "../vocabulary/source-evidence";

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

function evidenceFor(record: VocabularyRecord): keyof DictionaryEvidenceCounts {
  const evidence = evidenceForSources(record.sources, {
    verified: record.status === "verified",
    allowVerifiedWithoutFactualSource: true,
  });
  return evidence === "source-backed" ? "sourceBacked" : evidence === "ai-draft" ? "aiDraft" : "verified";
}

function isLlmOnlyAdvanced(record: VocabularyRecord): boolean {
  return record.tier === "advanced" && record.sources.length > 0 && record.sources.every((source) => source.sourceId === "llm");
}

function addRecord(counts: DictionaryQualityCounts, record: VocabularyRecord) {
  const primarySense = record.senses[0];
  counts.pages += 1;
  if (!primarySense?.definition.trim() || isPlaceholder(primarySense.definition)) counts.placeholders += 1;
  if (!primarySense || primarySense.examples.length === 0) counts.noExamples += 1;
  if (!primarySense?.partOfSpeech.trim() || primarySense.partOfSpeech.trim().toLowerCase() === "unknown") counts.unknownPartOfSpeech += 1;
  if (isLlmOnlyAdvanced(record)) counts.llmOnlyAdvanced += 1;
  if (record.connections.length === 0) counts.zeroConnections += 1;
  counts.evidence[evidenceFor(record)] += 1;

  for (const connection of record.connections) {
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

/** Aggregate dictionary-quality signals from canonical vocabulary records. */
export function auditDictionaryRecords(records: VocabularyRecord[]): DictionaryQualityReport {
  const report: DictionaryQualityReport = { total: emptyCounts(), lists: emptyRecord() };

  for (const record of records) {
    addRecord(report.total, record);
    for (const membership of new Set(record.lists.map((entry) => entry.id))) {
      report.lists[membership] ??= emptyCounts();
      addRecord(report.lists[membership], record);
    }
  }

  return report;
}

export function hasStrictFailures(report: DictionaryQualityReport): boolean {
  return report.total.placeholders > 0 || report.total.llmOnlyAdvanced > 0;
}
