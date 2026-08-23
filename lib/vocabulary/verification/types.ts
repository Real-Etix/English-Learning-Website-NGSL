import { z } from "zod";
import type { VocabularyRecord } from "../schema";

export const VerificationReasonCodeSchema = z.enum([
  "published",
  "no_factual_sense",
  "pos_mismatch",
  "no_sourced_example",
  "sense_ambiguous",
  "no_reciprocal_anchor",
  "relationship_unsupported",
  "relationship_ambiguous",
  "judge_unavailable",
  "provider_failed",
  "budget_exhausted",
]);
export type VerificationReasonCode = z.infer<typeof VerificationReasonCodeSchema>;

export type ReciprocalCoreAnchor = {
  coreLemma: string;
  candidateType: "builds_on";
  coreType: "advanced_form";
  candidateGloss: string;
  coreGloss: string;
};

export type VerificationCandidate = {
  record: VocabularyRecord;
  anchors: ReciprocalCoreAnchor[];
  incomingPublishedCount: number;
  distinctPublishedCoreAnchors: number;
};
