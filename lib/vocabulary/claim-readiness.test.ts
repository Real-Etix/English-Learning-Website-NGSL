import { describe, expect, it } from "vitest";

import { vocabularyRecordFixture } from "./test-fixtures";
import { claimReadiness } from "./claim-readiness";
import type { VocabularyRecord } from "./schema";
import { isWordPublic } from "./publication";

function reviewedMeaning() {
  const record = vocabularyRecordFixture();
  record.tier = "advanced";
  const sense = record.senses[0]!;
  sense.examples = [];
  sense.meaningReview = {
    policy: "limited-examples-v1", reviewedAt: "2026-10-16T00:00:00.000Z",
    reason: "Reviewed the exact dictionary meaning and its learning context.",
    contentSnapshot: JSON.stringify([
      record.lemma, record.display, record.editorial ?? null,
      sense.id, sense.partOfSpeech, sense.definition, sense.labels, sense.sources,
      sense.examples, sense.usagePatterns, sense.collocations, sense.commonMistakes,
    ]),
  };
  return record;
}

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
  it("publishes and permits meaning claims for an explicitly reviewed factual meaning without examples", () => {
    const record = reviewedMeaning();
    expect(isWordPublic(record)).toBe(true);
    expect(claimReadiness(record, record.senses[0]!.id)).toEqual({ canClaim: true, reason: null });
  });

  it.each(["definition", "source", "display", "scope", "example"])("invalidates a meaning approval when %s changes", (field) => {
    const record = reviewedMeaning();
    const sense = record.senses[0]!;
    if (field === "definition") sense.definition = "another meaning";
    if (field === "source") sense.sources[0]!.contentHash = "changed";
    if (field === "display") record.display = "another word";
    if (field === "scope") record.editorial = { scope: { status: "included", lists: ["fitness"], reason: "changed", reviewedAt: "2026-10-16T00:00:00.000Z" } };
    if (field === "example") sense.examples = vocabularyRecordFixture().senses[0]!.examples;
    expect(isWordPublic(record)).toBe(false);
    expect(claimReadiness(record, sense.id).canClaim).toBe(false);
  });

  it("does not allow a review receipt to bypass AI-only evidence or an archive", () => {
    const record = reviewedMeaning();
    record.senses[0]!.sources[0]!.sourceId = "llm";
    expect(claimReadiness(record, record.senses[0]!.id).canClaim).toBe(false);
    const archived = recordForClaim();
    archived.tier = "advanced";
    archived.editorial = { scope: { status: "archived", lists: [], reason: "Off topic", reviewedAt: "2026-10-16T00:00:00.000Z" } };
    expect(claimReadiness(archived, archived.senses[0]!.id).canClaim).toBe(false);
  });

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
