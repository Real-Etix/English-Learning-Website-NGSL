import { normalizeVocabularyLemma } from "../shards";
import type { VocabularyRecord } from "../schema";

export const ENRICHMENT_STAGES = ["ngsl", "academic", "business", "toeic", "fitness", "advanced"] as const;
export type EnrichmentStage = (typeof ENRICHMENT_STAGES)[number] | "all";

export type SelectEnrichmentBatchOptions = {
  limit: number;
  stage?: EnrichmentStage;
};

export type EnrichmentSelection = {
  record: VocabularyRecord;
  stage: (typeof ENRICHMENT_STAGES)[number];
  reason: string;
};

type Candidate = EnrichmentSelection & {
  rank: number | null;
  sfi: number | null;
  publishedCoreAnchors: number;
};

const compareOrdinal = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const nullLast = (left: number | null, right: number | null) => {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
};

function membershipFor(record: VocabularyRecord, id: Exclude<EnrichmentStage, "all" | "advanced">) {
  return record.lists.find((membership) => membership.id === id) ?? null;
}

function earliestNamedStage(record: VocabularyRecord): Exclude<EnrichmentStage, "all" | "advanced"> | null {
  for (const stage of ENRICHMENT_STAGES) {
    if (stage === "advanced") continue;
    if (membershipFor(record, stage)) return stage;
  }
  return null;
}

function publishedCoreAnchors(record: VocabularyRecord, publishedCoreLemmas: Set<string>): number {
  const anchors = new Set<string>();
  for (const connection of record.connections) {
    const target = normalizeVocabularyLemma(connection.target);
    if (
      connection.status === "published"
      && connection.gloss?.trim()
      && publishedCoreLemmas.has(target)
    ) anchors.add(target);
  }
  return anchors.size;
}

function candidateFor(record: VocabularyRecord, publishedCoreLemmas: Set<string>): Candidate | null {
  // Verified records already satisfy the automated enrichment contract and are
  // never sent through a drafting batch.
  if (record.status === "verified") return null;

  const namedStage = earliestNamedStage(record);
  if (record.tier === "core" && namedStage) {
    const membership = membershipFor(record, namedStage)!;
    if (namedStage === "ngsl") {
      return {
        record,
        stage: namedStage,
        rank: membership.rank,
        sfi: membership.sfi,
        publishedCoreAnchors: 0,
        reason: `NGSL SFI ${membership.sfi ?? "none"}; rank ${membership.rank ?? "none"}`,
      };
    }
    return {
      record,
      stage: namedStage,
      rank: membership.rank,
      sfi: null,
      publishedCoreAnchors: 0,
      reason: `${namedStage} rank ${membership.rank ?? "none"}`,
    };
  }

  if (record.tier === "advanced" && record.publicationStatus === "hidden") {
    const anchorCount = publishedCoreAnchors(record, publishedCoreLemmas);
    return {
      record,
      stage: "advanced",
      rank: null,
      sfi: null,
      publishedCoreAnchors: anchorCount,
      reason: `hidden advanced draft with ${anchorCount} published core anchor${anchorCount === 1 ? "" : "s"}`,
    };
  }

  return null;
}

function compareCandidates(left: Candidate, right: Candidate): number {
  const stageDifference = ENRICHMENT_STAGES.indexOf(left.stage) - ENRICHMENT_STAGES.indexOf(right.stage);
  if (stageDifference !== 0) return stageDifference;

  if (left.stage === "ngsl") {
    const sfiDifference = left.sfi === null || right.sfi === null
      ? nullLast(left.sfi, right.sfi)
      : right.sfi - left.sfi;
    if (sfiDifference !== 0) return sfiDifference;
    const rankDifference = nullLast(left.rank, right.rank);
    if (rankDifference !== 0) return rankDifference;
  } else if (left.stage === "advanced") {
    const anchorDifference = right.publishedCoreAnchors - left.publishedCoreAnchors;
    if (anchorDifference !== 0) return anchorDifference;
  } else {
    const rankDifference = nullLast(left.rank, right.rank);
    if (rankDifference !== 0) return rankDifference;
  }

  return compareOrdinal(normalizeVocabularyLemma(left.record.lemma), normalizeVocabularyLemma(right.record.lemma));
}

/**
 * Selects a reproducible enrichment batch. Records shared by multiple lists
 * receive the first named-list priority, and hidden advanced drafts always
 * follow every named list.
 */
export function selectEnrichmentBatchDetails(
  records: VocabularyRecord[],
  options: SelectEnrichmentBatchOptions,
): EnrichmentSelection[] {
  const limit = Number.isFinite(options.limit) ? Math.max(0, Math.floor(options.limit)) : 0;
  if (limit === 0) return [];

  const stage = options.stage ?? "all";
  const publishedCoreLemmas = new Set(
    records
      .filter((record) => record.tier === "core" && record.publicationStatus === "published")
      .map((record) => normalizeVocabularyLemma(record.lemma)),
  );
  const candidates = records
    .map((record) => candidateFor(record, publishedCoreLemmas))
    .filter((candidate): candidate is Candidate => candidate !== null)
    .filter((candidate) => stage === "all" || candidate.stage === stage)
    .sort(compareCandidates);

  const seen = new Set<string>();
  const selected: EnrichmentSelection[] = [];
  for (const candidate of candidates) {
    const lemma = normalizeVocabularyLemma(candidate.record.lemma);
    if (seen.has(lemma)) continue;
    seen.add(lemma);
    selected.push({ record: candidate.record, stage: candidate.stage, reason: candidate.reason });
    if (selected.length === limit) break;
  }
  return selected;
}

export function selectEnrichmentBatch(
  records: VocabularyRecord[],
  options: SelectEnrichmentBatchOptions,
): VocabularyRecord[] {
  return selectEnrichmentBatchDetails(records, options).map(({ record }) => record);
}
