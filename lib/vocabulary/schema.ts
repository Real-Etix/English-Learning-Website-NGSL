import { z } from "zod";
import sourceRegistryFile from "../../content/vocabulary/sources.json";
import { normalizeVocabularyLemma } from "./shards";

/** Validates authored text without coercing it: canonical files retain exact spacing. */
const nonEmpty = z.string().min(1).refine((value) => value.trim().length > 0, "Text must not be blank");
const normalizedLemma = z.string().min(1).refine(
  (value) => normalizeVocabularyLemma(value) === value,
  "Lemma must be normalized",
);
const nullableText = nonEmpty.nullable();
const sourceId = nonEmpty.regex(/^[a-z0-9][a-z0-9._-]*$/);
const registeredSourceIds = new Set(
  sourceRegistryFile.sources.map((source) => source.id),
);
const registeredSourceId = sourceId.refine(
  (value) => registeredSourceIds.has(value),
  "Source ID must be registered",
);
const finiteRank = z.number().int().min(1).finite().nullable();
const finiteSfi = z.number().min(0).max(100).finite().nullable();

export const PublicationStatusSchema = z.enum(["draft", "review", "published", "hidden"]);
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;

export const SourceRegistryEntrySchema = z.object({
  id: sourceId,
  label: nonEmpty,
  homepage: z.url().nullable(),
  license: nullableText,
  factual: z.boolean(),
}).strict();
export type SourceRegistryEntry = z.infer<typeof SourceRegistryEntrySchema>;

export const SourceRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(SourceRegistryEntrySchema),
}).strict();
export type SourceRegistry = z.infer<typeof SourceRegistrySchema>;

const ContentSourceRefSchema = z.object({
  sourceId: registeredSourceId,
  externalId: nullableText,
  url: z.url().nullable(),
  retrievedAt: z.iso.datetime().nullable(),
  contentHash: nullableText,
}).strict();
export type ContentSourceRef = z.infer<typeof ContentSourceRefSchema>;

const SenseExampleSchema = z.object({
  text: nonEmpty,
  sources: z.array(ContentSourceRefSchema),
}).strict();

const UsagePatternSchema = z.object({
  pattern: nonEmpty,
  explanation: nonEmpty,
  examples: z.array(SenseExampleSchema),
  sources: z.array(ContentSourceRefSchema),
  status: PublicationStatusSchema,
}).strict();

const CollocationPhraseSchema = z.object({
  phrase: nonEmpty,
  explanation: nullableText,
  sources: z.array(ContentSourceRefSchema),
  status: PublicationStatusSchema,
}).strict();

const CommonMistakeSchema = z.object({
  incorrect: nonEmpty,
  correction: nonEmpty,
  explanation: nonEmpty,
  sources: z.array(ContentSourceRefSchema),
  status: PublicationStatusSchema,
}).strict();

const VocabularySenseSchema = z.object({
  id: nonEmpty,
  partOfSpeech: nonEmpty,
  definition: nonEmpty,
  labels: z.array(nonEmpty),
  sources: z.array(ContentSourceRefSchema),
  examples: z.array(SenseExampleSchema),
  usagePatterns: z.array(UsagePatternSchema),
  collocations: z.array(CollocationPhraseSchema),
  commonMistakes: z.array(CommonMistakeSchema),
  status: PublicationStatusSchema,
}).strict();
export type VocabularySense = z.infer<typeof VocabularySenseSchema>;

const PronunciationRecordSchema = z.object({
  ipa: nullableText,
  region: z.enum(["uk", "us", "other"]),
  audioUrl: z.url().nullable(),
  sources: z.array(ContentSourceRefSchema),
}).strict();

const VocabularyConnectionSchema = z.object({
  target: normalizedLemma,
  type: z.enum([
    "synonym",
    "antonym",
    "intensity",
    "builds_on",
    "advanced_form",
    "morphological",
    "collocation",
  ]),
  gloss: nullableText,
  sources: z.array(ContentSourceRefSchema),
  status: z.enum(["unreviewed", "published", "hidden"]),
}).strict();
export type VocabularyConnection = z.infer<typeof VocabularyConnectionSchema>;

const VocabularyListMembershipSchema = z.object({
  id: nonEmpty,
  rank: finiteRank,
  sfi: finiteSfi,
}).strict();

export const VocabularyRecordSchema = z.object({
  schemaVersion: z.literal(1),
  lemma: normalizedLemma,
  display: nonEmpty,
  tier: z.enum(["core", "advanced"]),
  partOfSpeech: nonEmpty,
  forms: z.array(nonEmpty),
  lists: z.array(VocabularyListMembershipSchema),
  status: z.enum(["seeded", "enriched", "verified"]),
  publicationStatus: PublicationStatusSchema,
  sources: z.array(ContentSourceRefSchema),
  senses: z.array(VocabularySenseSchema),
  pronunciation: z.array(PronunciationRecordSchema),
  usageNote: nullableText,
  connections: z.array(VocabularyConnectionSchema),
  domains: z.array(nonEmpty),
  chart: nullableText,
  region: nullableText,
}).strict();

export type VocabularyRecord = z.infer<typeof VocabularyRecordSchema>;
