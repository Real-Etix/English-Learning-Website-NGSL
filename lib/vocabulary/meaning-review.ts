import type { VocabularyRecord, VocabularySense } from "./schema";
import { isFactualSourceId } from "./source-evidence";

/** Exact, browser-safe review snapshot, not a signature or a source of evidence.
 * Status is excluded so an approved review can be explicitly published later.
 * Changes to content, source attribution or editorial scope require a new review.
 */
export function meaningReviewSnapshot(record: VocabularyRecord, sense: VocabularySense): string {
  return JSON.stringify([
    record.lemma, record.display, record.editorial ?? null,
    sense.id, sense.partOfSpeech, sense.definition, sense.labels, sense.sources,
    sense.examples, sense.usagePatterns, sense.collocations, sense.commonMistakes,
  ]);
}

export function hasCurrentMeaningReview(record: VocabularyRecord, sense: VocabularySense): boolean {
  const review = sense.meaningReview;
  return Boolean(review?.policy === "limited-examples-v1"
    && review.reason.trim() && Number.isFinite(Date.parse(review.reviewedAt))
    && review.contentSnapshot === meaningReviewSnapshot(record, sense)
    && sense.sources.some(source => isFactualSourceId(source.sourceId)
      && source.url && /^https?:\/\//.test(source.url) && source.contentHash));
}

export function hasFactualExample(sense: VocabularySense): boolean {
  return sense.examples.some(example => example.text.trim()
    && example.sources.some(source => isFactualSourceId(source.sourceId)));
}

/** New meaning-only releases cannot unlock example-dependent production practice. */
export function needsExampleForPractice(record: VocabularyRecord, sense: VocabularySense): boolean {
  return Boolean(sense.meaningReview && (!hasCurrentMeaningReview(record, sense) || !hasFactualExample(sense)));
}
