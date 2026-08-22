import { describe, expect, it } from "vitest";

import { vocabularyRecordFixture } from "./test-fixtures";
import { claimReadiness } from "./claim-readiness";
import type { VocabularyRecord } from "./schema";

const sourceRef = (sourceId: "curated" | "dictionaryapi" | "llm" | "tatoeba" | "wordnet") => ({
  sourceId,
  externalId: null,
  url: null,
  retrievedAt: null,
  contentHash: null,
});

function recordForClaim(): VocabularyRecord {
  const record = vocabularyRecordFixture();
  return {
    ...record,
    lemma: "bank",
    display: "bank",
    senses: [{
      ...record.senses[0]!,
      id: "bank:wordnet:1",
      sources: [sourceRef("wordnet")],
      examples: [{ text: "She went to the bank before work.", sources: [sourceRef("tatoeba")] }],
      status: "published" as const,
    }],
  };
}

describe("claimReadiness", () => {
  it("allows a selected published factual sense with a sourced example", () => {
    expect(claimReadiness(recordForClaim(), "bank:wordnet:1")).toEqual({ canClaim: true, reason: null });
  });

  it("blocks a missing selected sense", () => {
    expect(claimReadiness(recordForClaim(), "")).toMatchObject({ canClaim: false });
  });

  it("blocks a selected sense from another lemma", () => {
    expect(claimReadiness(recordForClaim(), "river:wordnet:1")).toMatchObject({ canClaim: false });
  });

  it("matches the selected sense ID exactly", () => {
    expect(claimReadiness(recordForClaim(), " bank:wordnet:1 ")).toMatchObject({ canClaim: false });
  });

  it("blocks a draft selected sense", () => {
    const record = recordForClaim();
    record.senses[0]!.status = "draft";

    expect(claimReadiness(record, "bank:wordnet:1")).toMatchObject({ canClaim: false });
  });

  it("blocks an AI-only selected sense", () => {
    const record = recordForClaim();
    record.senses[0]!.sources = [sourceRef("llm")];
    record.senses[0]!.examples = [{ text: "The AI drafted this example.", sources: [sourceRef("llm")] }];

    expect(claimReadiness(record, "bank:wordnet:1")).toMatchObject({ canClaim: false });
  });

  it("blocks a selected sense without a sourced example", () => {
    const record = recordForClaim();
    record.senses[0]!.examples = [];

    expect(claimReadiness(record, "bank:wordnet:1").reason)
      .toBe("This meaning needs a sourced example before it can be claimed.");
  });

  it("allows an explicitly verified example without a source reference", () => {
    const record = recordForClaim();
    record.senses[0]!.examples = [{ text: "The verified editorial example.", sources: [] }];

    expect(claimReadiness(record, "bank:wordnet:1")).toEqual({ canClaim: true, reason: null });
  });

  it("blocks a hidden word", () => {
    const record = recordForClaim();
    record.publicationStatus = "hidden";

    expect(claimReadiness(record, "bank:wordnet:1")).toMatchObject({ canClaim: false });
  });

  it("blocks a selected sense with a placeholder definition", () => {
    const record = recordForClaim();
    record.senses[0]!.definition = "Definition pending — needs review.";

    expect(claimReadiness(record, "bank:wordnet:1")).toMatchObject({ canClaim: false });
  });
});
