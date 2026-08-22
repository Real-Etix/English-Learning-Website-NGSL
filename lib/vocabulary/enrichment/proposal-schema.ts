import { z } from "zod";

const nonEmpty = z.string().min(1).refine((value) => value.trim().length > 0, "Text must not be blank");

const ConnectionGuidanceSchema = z.object({
  target: nonEmpty,
  type: z.enum([
    "synonym",
    "antonym",
    "intensity",
    "builds_on",
    "advanced_form",
    "morphological",
    "collocation",
  ]),
  gloss: nonEmpty,
}).strict();

const UsagePatternGuidanceSchema = z.object({
  senseId: nonEmpty,
  pattern: nonEmpty,
  explanation: nonEmpty,
}).strict();

/**
 * The only shape accepted from an LLM drafting pass. Provenance, definitions,
 * and publication state are intentionally absent: those fields are owned by
 * factual import and human review respectively.
 */
export const VocabularyEnrichmentProposalSchema = z.object({
  connections: z.array(ConnectionGuidanceSchema).optional(),
  usagePatterns: z.array(UsagePatternGuidanceSchema).optional(),
}).strict();

export type VocabularyEnrichmentProposal = z.infer<typeof VocabularyEnrichmentProposalSchema>;
