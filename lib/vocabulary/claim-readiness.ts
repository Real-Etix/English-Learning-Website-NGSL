import { factualEvidenceFor } from "./publication";
import type { VocabularyRecord, VocabularySense } from "./schema";
import { evidenceForSources } from "./source-evidence";

export type ClaimReadiness = { canClaim: boolean; reason: string | null };

const PLACEHOLDER_CONTENT = /definition pending|needs a fuller dictionary source/i;

const blocked = (reason: string): ClaimReadiness => ({ canClaim: false, reason });

function hasUsableDefinition(sense: VocabularySense): boolean {
  return Boolean(sense.definition.trim()) && !PLACEHOLDER_CONTENT.test(sense.definition);
}

function hasClaimableExample(record: VocabularyRecord, sense: VocabularySense): boolean {
  return sense.examples.some((example) =>
    Boolean(example.text.trim())
    && evidenceForSources(example.sources, {
      verified: record.status === "verified",
      allowVerifiedWithoutFactualSource: true,
    }) !== "ai-draft",
  );
}

/** Returns whether one exact, canonical sense is ready to create a new claim. */
export function claimReadiness(record: VocabularyRecord, senseId: string): ClaimReadiness {
  if (record.publicationStatus !== "published") {
    return blocked("This word is not available to claim.");
  }

  if (!senseId.trim()) {
    return blocked("Choose a meaning before claiming this word.");
  }

  const sense = record.senses.find((candidate) => candidate.id === senseId);
  if (!sense) {
    return blocked("That meaning does not belong to this word.");
  }
  if (sense.status !== "published") {
    return blocked("This meaning is not published yet.");
  }
  if (!hasUsableDefinition(sense)) {
    return blocked("This meaning needs a complete definition before it can be claimed.");
  }
  if (factualEvidenceFor(record, sense) === "ai-draft") {
    return blocked("This meaning needs a trustworthy source before it can be claimed.");
  }
  if (!hasClaimableExample(record, sense)) {
    return blocked("This meaning needs a sourced example before it can be claimed.");
  }

  return { canClaim: true, reason: null };
}
