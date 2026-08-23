import { createHash } from "node:crypto";

import type { WordDetail } from "../../content/word-detail";
import { VocabularyRecordSchema, type ContentSourceRef, type VocabularyRecord } from "../schema";
import { senseIdFor } from "../sense-id";
import { isFactualSourceId, sourceEntryFor } from "../source-evidence";

export type DictionaryImportSource = {
  sourceId: string;
  url: string | null;
  retrievedAt: string | null;
  contentHash: string | null;
};

export type DictionaryImportResult = {
  record: VocabularyRecord;
  changed: boolean;
};

function sameSource(left: ContentSourceRef, right: ContentSourceRef): boolean {
  return left.sourceId === right.sourceId
    && left.externalId === right.externalId
    && left.url === right.url
    && left.retrievedAt === right.retrievedAt
    && left.contentHash === right.contentHash;
}

function sourceRef(
  source: DictionaryImportSource,
  externalId: string,
  url: string | null,
): ContentSourceRef {
  return {
    sourceId: source.sourceId,
    externalId,
    url,
    retrievedAt: source.retrievedAt,
    contentHash: source.contentHash,
  };
}

function normalizeFallbackText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function fallbackExternalId(record: VocabularyRecord, detail: WordDetail, sense: WordDetail["senses"][number]): string {
  const material = JSON.stringify([
    normalizeFallbackText(record.lemma),
    normalizeFallbackText(sense.sourceEntryId ?? detail.sourceEntryId),
    normalizeFallbackText(sense.sourceUrl ?? detail.sourceUrl),
    normalizeFallbackText(sense.partOfSpeech || record.partOfSpeech),
    normalizeFallbackText(sense.definition),
    normalizeFallbackText(sense.example),
  ]);
  return `content-${createHash("sha256").update(material, "utf8").digest("hex").slice(0, 20)}`;
}

function senseExternalId(record: VocabularyRecord, detail: WordDetail, sense: WordDetail["senses"][number]): string {
  return sense.sourceSenseId
    ?? sense.sourceEntryId
    ?? detail.sourceEntryId
    ?? fallbackExternalId(record, detail, sense);
}

/**
 * Returns the canonical ID that a factual dictionary sense will retain after
 * import. Callers must continue to persist the provider wording unchanged.
 */
export function dictionarySenseId(
  record: VocabularyRecord,
  detail: WordDetail,
  sense: WordDetail["senses"][number],
  sourceId: string,
): string {
  return senseIdFor({
    lemma: record.lemma,
    sourceId,
    externalId: senseExternalId(record, detail, sense),
    partOfSpeech: sense.partOfSpeech || record.partOfSpeech,
    definition: sense.definition,
  });
}

function appendPronunciation(
  pronunciation: VocabularyRecord["pronunciation"],
  value: { ipa: string | null; region: "uk" | "us" | "other"; audioUrl: string | null },
  sources: ContentSourceRef[],
): VocabularyRecord["pronunciation"] {
  const exists = pronunciation.some((candidate) =>
    candidate.ipa === value.ipa
    && candidate.region === value.region
    && candidate.audioUrl === value.audioUrl
    && candidate.sources.length === sources.length
    && candidate.sources.every((source, index) => sameSource(source, sources[index]!)),
  );
  return exists ? pronunciation : [...pronunciation, { ...value, sources }];
}

/**
 * Converts one fetched factual dictionary detail into a reviewable canonical
 * record. It only appends source-distinct senses, so it cannot replace stronger
 * curated or verified wording.
 */
export function importDictionaryDetail(
  record: VocabularyRecord,
  detail: WordDetail,
  source: DictionaryImportSource,
): DictionaryImportResult {
  const provider = sourceEntryFor(source.sourceId);
  if (!isFactualSourceId(provider.id)) throw new Error(`Dictionary import source must be factual: ${provider.id}`);

  const entryExternalId = detail.sourceEntryId ?? record.lemma;
  const entryUrl = detail.sourceUrl ?? source.url;
  const entrySource = sourceRef(source, entryExternalId, entryUrl);
  const sources = record.sources.some((candidate) => sameSource(candidate, entrySource))
    ? record.sources
    : [...record.sources, entrySource];
  let senses = record.senses;

  detail.senses.forEach((sense) => {
    if (!sense.definition.trim()) return;
    const externalId = senseExternalId(record, detail, sense);
    const senseSource = sourceRef(source, externalId, sense.sourceUrl ?? entryUrl);
    const id = dictionarySenseId(record, detail, sense, source.sourceId);
    if (senses.some((candidate) => candidate.id === id)) return;
    senses = [...senses, {
      id,
      partOfSpeech: sense.partOfSpeech || record.partOfSpeech,
      definition: sense.definition,
      labels: [],
      sources: [senseSource],
      examples: sense.example ? [{ text: sense.example, sources: [senseSource] }] : [],
      usagePatterns: [],
      collocations: [],
      commonMistakes: [],
      status: "review",
    }];
  });

  let pronunciation = record.pronunciation;
  const pronunciationSourceFor = (metadata: { entryId?: string; url?: string | null } | undefined) => [sourceRef(
    source,
    metadata?.entryId ?? detail.sourceEntryId ?? record.lemma,
    metadata?.url ?? entryUrl,
  )];
  if (detail.ipa) {
    pronunciation = appendPronunciation(pronunciation, {
      ipa: detail.ipa, region: "other", audioUrl: null,
    }, pronunciationSourceFor(detail.pronunciationSources?.ipa));
  }
  if (detail.audioUk) {
    pronunciation = appendPronunciation(pronunciation, {
      ipa: null, region: "uk", audioUrl: detail.audioUk,
    }, pronunciationSourceFor(detail.pronunciationSources?.audioUk));
  }
  if (detail.audioUs) {
    pronunciation = appendPronunciation(pronunciation, {
      ipa: null, region: "us", audioUrl: detail.audioUs,
    }, pronunciationSourceFor(detail.pronunciationSources?.audioUs));
  }
  if (detail.audioAny) {
    pronunciation = appendPronunciation(pronunciation, {
      ipa: null, region: "other", audioUrl: detail.audioAny,
    }, pronunciationSourceFor(detail.pronunciationSources?.audioAny));
  }

  if (sources === record.sources && senses === record.senses && pronunciation === record.pronunciation) {
    return { record, changed: false };
  }
  return {
    record: VocabularyRecordSchema.parse({ ...record, sources, senses, pronunciation }),
    changed: true,
  };
}
