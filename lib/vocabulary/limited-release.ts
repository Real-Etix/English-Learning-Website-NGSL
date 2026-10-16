import { createHash } from "node:crypto";
import { z } from "zod";
import { VocabularyRecordSchema, type VocabularyRecord } from "./schema";
import { meaningReviewSnapshot } from "./meaning-review";
import { isSenseContentReady } from "./publication";

export const LimitedReleaseDecisionSchema = z.object({
  beforeHash: z.string().regex(/^[a-f0-9]{64}$/),
  senseId: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  reviewedAt: z.iso.datetime(),
}).strict();
export const LimitedReleaseManifestSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), LimitedReleaseDecisionSchema),
  withheld: z.record(z.string(), z.string().trim().min(1)),
}).strict();
export const releaseRecordHash = (record: VocabularyRecord) => createHash("sha256").update(JSON.stringify(record)).digest("hex");

/** Offline-only explicit publication; never discovers or approves new candidates. */
export function applyLimitedRelease(record: VocabularyRecord, input: z.infer<typeof LimitedReleaseDecisionSchema>): VocabularyRecord {
  const decision = LimitedReleaseDecisionSchema.parse(input);
  if (record.tier !== "advanced" || record.editorial?.scope?.status === "archived") throw new Error(`Not a releasable advanced word: ${record.lemma}`);
  const next = structuredClone(record);
  const selected = next.senses.find(s => s.id === decision.senseId);
  if (!selected) throw new Error(`Missing reviewed sense: ${record.lemma}`);
  selected.meaningReview = { policy: "limited-examples-v1", reviewedAt: decision.reviewedAt, reason: decision.reason, contentSnapshot: meaningReviewSnapshot(next, selected) };
  if (!isSenseContentReady(next, selected)) throw new Error(`Missing attributable, usable definition: ${record.lemma}`);
  for (const sense of next.senses) sense.status = sense === selected ? "published" : "hidden";
  next.publicationStatus = "published";
  next.verificationStatus = "published";
  next.partOfSpeech = selected.partOfSpeech;
  // Relationships retain their independent status; no automatic edge promotion.
  const parsed = VocabularyRecordSchema.parse(next);
  if (releaseRecordHash(parsed) === releaseRecordHash(record)) return parsed;
  if (releaseRecordHash(record) !== decision.beforeHash) throw new Error(`Record changed since review: ${record.lemma}`);
  if (record.publicationStatus === "published") throw new Error(`Expected a hidden/review candidate: ${record.lemma}`);
  return parsed;
}
