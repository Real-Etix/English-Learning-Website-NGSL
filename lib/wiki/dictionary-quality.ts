import { claimReadiness } from "../vocabulary/claim-readiness";
import { factualEvidenceFor } from "../vocabulary/publication";
import type { VocabularyRecord, VocabularySense } from "../vocabulary/schema";
import { evidenceForSources, sourceRefsForSense } from "../vocabulary/source-evidence";

export type DictionaryEvidenceCounts = {
  verified: number;
  sourceBacked: number;
  aiDraft: number;
};

export type DictionaryStrictViolationCounts = {
  publishedPlaceholders: number;
  publishedUnsupportedSenses: number;
  claimableSensesWithoutSourcedExamples: number;
  publishedConnectionsToHiddenOrMissingTargets: number;
  learnerConnectionsWithoutGloss: number;
};

type DictionaryPublicationCounts = { draft: number; review: number; published: number; hidden: number };
type DictionarySenseCounts = { total: number; unsupported: number; withoutExamples: number };
type DictionaryUsageCounts = { withoutPatterns: number; withoutMistakes: number };
type DictionaryConnectionCounts = { published: number; unreviewed: number; hidden: number; unexplained: number };
type DictionaryAdvancedCounts = { quarantined: number; reviewable: number; published: number };
type DictionarySourceCounts = { curated: number; wordnet: number; dictionaryapi: number; tatoeba: number; llm: number };

export type DictionaryEdgeCounts = {
  total: number;
  published: number;
  unreviewed: number;
  hidden: number;
  explained: number;
  unexplained: number;
  explainedByStatus: { published: number; unreviewed: number; hidden: number };
  byType: Record<string, {
    total: number;
    published: number;
    unreviewed: number;
    hidden: number;
    explained: number;
    unexplained: number;
    explainedByStatus: { published: number; unreviewed: number; hidden: number };
  }>;
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
  publication: DictionaryPublicationCounts;
  senses: DictionarySenseCounts;
  usage: DictionaryUsageCounts;
  connections: DictionaryConnectionCounts;
  advanced: DictionaryAdvancedCounts;
  claimableSenses: number;
  sources: DictionarySourceCounts;
  strict: DictionaryStrictViolationCounts;
};

export type DictionaryQualityReport = {
  total: DictionaryQualityCounts;
  lists: Record<string, DictionaryQualityCounts>;
};

const isPlaceholder = (value: string) =>
  /definition pending|needs a fuller dictionary source/i.test(value);

const strictViolationKeys: Array<keyof DictionaryStrictViolationCounts> = [
  "publishedPlaceholders",
  "publishedUnsupportedSenses",
  "claimableSensesWithoutSourcedExamples",
  "publishedConnectionsToHiddenOrMissingTargets",
  "learnerConnectionsWithoutGloss",
];

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
    edges: {
      total: 0, published: 0, unreviewed: 0, hidden: 0, explained: 0, unexplained: 0,
      explainedByStatus: { published: 0, unreviewed: 0, hidden: 0 }, byType: emptyRecord(),
    },
    publication: { draft: 0, review: 0, published: 0, hidden: 0 },
    senses: { total: 0, unsupported: 0, withoutExamples: 0 },
    usage: { withoutPatterns: 0, withoutMistakes: 0 },
    connections: { published: 0, unreviewed: 0, hidden: 0, unexplained: 0 },
    advanced: { quarantined: 0, reviewable: 0, published: 0 },
    claimableSenses: 0,
    sources: { curated: 0, wordnet: 0, dictionaryapi: 0, tatoeba: 0, llm: 0 },
    strict: {
      publishedPlaceholders: 0,
      publishedUnsupportedSenses: 0,
      claimableSensesWithoutSourcedExamples: 0,
      publishedConnectionsToHiddenOrMissingTargets: 0,
      learnerConnectionsWithoutGloss: 0,
    },
  };
}

function evidenceFor(record: VocabularyRecord): keyof DictionaryEvidenceCounts {
  const primarySense = record.senses[0];
  const primarySources = primarySense ? sourceRefsForSense(primarySense) : [];
  const evidence = evidenceForSources(primarySources, {
    verified: record.status === "verified",
    allowVerifiedWithoutFactualSource: record.status === "verified"
      && primarySources.length === 0
      && record.sources.length === 0,
  });
  return evidence === "source-backed" ? "sourceBacked" : evidence === "ai-draft" ? "aiDraft" : "verified";
}

function isLlmOnlyAdvanced(record: VocabularyRecord): boolean {
  return record.tier === "advanced" && record.sources.length > 0 && record.sources.every((source) => source.sourceId === "llm");
}

function hasExampleText(sense: VocabularySense): boolean {
  return sense.examples.some((example) => Boolean(example.text.trim()));
}

function recordSourceIds(record: VocabularyRecord): Set<keyof DictionarySourceCounts> {
  const sourceIds = new Set(record.sources.map((source) => source.sourceId));
  return new Set([...sourceIds].filter((sourceId): sourceId is keyof DictionarySourceCounts =>
    sourceId === "curated" || sourceId === "wordnet" || sourceId === "dictionaryapi" || sourceId === "tatoeba" || sourceId === "llm",
  ));
}

function addRecord(counts: DictionaryQualityCounts, record: VocabularyRecord, recordsByLemma: ReadonlyMap<string, VocabularyRecord>) {
  const primarySense = record.senses[0];
  counts.pages += 1;
  if (!primarySense?.definition.trim() || isPlaceholder(primarySense.definition)) counts.placeholders += 1;
  if (!primarySense || primarySense.examples.length === 0) counts.noExamples += 1;
  if (!primarySense?.partOfSpeech.trim() || primarySense.partOfSpeech.trim().toLowerCase() === "unknown") counts.unknownPartOfSpeech += 1;
  if (isLlmOnlyAdvanced(record)) counts.llmOnlyAdvanced += 1;
  if (record.connections.length === 0) counts.zeroConnections += 1;
  counts.evidence[evidenceFor(record)] += 1;
  counts.publication[record.publicationStatus] += 1;
  if (record.tier === "advanced") {
    if (record.publicationStatus === "hidden") counts.advanced.quarantined += 1;
    if (record.publicationStatus === "review") counts.advanced.reviewable += 1;
    if (record.publicationStatus === "published") counts.advanced.published += 1;
  }
  for (const sourceId of recordSourceIds(record)) counts.sources[sourceId] += 1;

  for (const sense of record.senses) {
    const unsupported = factualEvidenceFor(record, sense) === "ai-draft";
    const claim = claimReadiness(record, sense.id);
    counts.senses.total += 1;
    if (unsupported) counts.senses.unsupported += 1;
    if (!hasExampleText(sense)) counts.senses.withoutExamples += 1;
    if (sense.usagePatterns.length === 0) counts.usage.withoutPatterns += 1;
    if (sense.commonMistakes.length === 0) counts.usage.withoutMistakes += 1;
    if (claim.canClaim) counts.claimableSenses += 1;

    if (record.publicationStatus === "published" && sense.status === "published") {
      if (!sense.definition.trim() || isPlaceholder(sense.definition)) counts.strict.publishedPlaceholders += 1;
      if (unsupported) counts.strict.publishedUnsupportedSenses += 1;
      if (claim.reason === "This meaning needs a sourced example before it can be claimed.") {
        counts.strict.claimableSensesWithoutSourcedExamples += 1;
      }
    }
  }

  for (const connection of record.connections) {
    const edge = counts.edges.byType[connection.type] ?? {
      total: 0, published: 0, unreviewed: 0, hidden: 0, explained: 0, unexplained: 0,
      explainedByStatus: { published: 0, unreviewed: 0, hidden: 0 },
    };
    counts.edges.byType[connection.type] = edge;
    counts.edges.total += 1;
    edge.total += 1;
    counts.edges[connection.status] += 1;
    edge[connection.status] += 1;
    counts.connections[connection.status] += 1;
    if (connection.gloss?.trim()) {
      counts.edges.explained += 1;
      edge.explained += 1;
      counts.edges.explainedByStatus[connection.status] += 1;
      edge.explainedByStatus[connection.status] += 1;
    } else {
      counts.edges.unexplained += 1;
      edge.unexplained += 1;
      counts.connections.unexplained += 1;
    }
    if (connection.status === "published") {
      if (recordsByLemma.get(connection.target)?.publicationStatus !== "published") {
        counts.strict.publishedConnectionsToHiddenOrMissingTargets += 1;
      }
      if (!connection.gloss?.trim()) {
        counts.strict.learnerConnectionsWithoutGloss += 1;
      }
    }
  }
}

function sortedRecord<T>(entries: Record<string, T>): Record<string, T> {
  const sorted = emptyRecord<T>();
  for (const key of Object.keys(entries).sort()) sorted[key] = entries[key]!;
  return sorted;
}

function sortedCounts(counts: DictionaryQualityCounts): DictionaryQualityCounts {
  counts.edges.byType = sortedRecord(counts.edges.byType);
  return counts;
}

/** Aggregate dictionary-quality signals from canonical vocabulary records. */
export function auditDictionaryRecords(records: VocabularyRecord[]): DictionaryQualityReport {
  const report: DictionaryQualityReport = { total: emptyCounts(), lists: emptyRecord() };
  const recordsByLemma = new Map(records.map((record) => [record.lemma, record]));

  for (const record of records) {
    addRecord(report.total, record, recordsByLemma);
    for (const membership of new Set(record.lists.map((entry) => entry.id))) {
      report.lists[membership] ??= emptyCounts();
      addRecord(report.lists[membership], record, recordsByLemma);
    }
  }

  return {
    total: sortedCounts(report.total),
    lists: sortedRecord(Object.fromEntries(Object.entries(report.lists).map(([list, counts]) => [list, sortedCounts(counts)]))),
  };
}

export function hasStrictFailures(report: DictionaryQualityReport): boolean {
  return strictViolationKeys.some((key) => report.total.strict[key] > 0);
}

/** Returns stable, human-readable strict categories that worsened against a base audit report. */
export function strictViolationRegressions(
  current: DictionaryStrictViolationCounts,
  base: DictionaryStrictViolationCounts,
): string[] {
  return strictViolationKeys.flatMap((key) => current[key] > base[key]
    ? [`${key} increased from ${base[key]} to ${current[key]}`]
    : []);
}
