import { describe, expect, test } from "vitest";

import { VocabularyEnrichmentProposalSchema } from "./proposal-schema";

describe("VocabularyEnrichmentProposalSchema", () => {
  test("rejects fabricated source IDs and publication state", () => {
    const result = VocabularyEnrichmentProposalSchema.safeParse({
      connections: [{
        target: "purchase",
        type: "advanced_form",
        gloss: "A more formal word for buying.",
        sourceId: "wordnet",
        status: "published",
      }],
    });

    expect(result.success).toBe(false);
  });

  test("rejects blank glosses and unknown proposal fields", () => {
    expect(VocabularyEnrichmentProposalSchema.safeParse({
      connections: [{ target: "purchase", type: "advanced_form", gloss: "   " }],
    }).success).toBe(false);
    expect(VocabularyEnrichmentProposalSchema.safeParse({
      createAdvanced: { lemma: "procure" },
    }).success).toBe(false);
  });

  test("does not accept LLM definitions", () => {
    expect(VocabularyEnrichmentProposalSchema.safeParse({
      definitions: [{ senseId: "buy-verb-1", definition: "to get by paying" }],
    }).success).toBe(false);
  });

  test("accepts guidance-only usage-pattern proposals", () => {
    expect(VocabularyEnrichmentProposalSchema.parse({
      usagePatterns: [{
        senseId: "buy-verb-1",
        pattern: "buy something from someone",
        explanation: "Use this pattern to name the seller.",
      }],
    })).toEqual({
      usagePatterns: [{
        senseId: "buy-verb-1",
        pattern: "buy something from someone",
        explanation: "Use this pattern to name the seller.",
      }],
    });
  });
});
