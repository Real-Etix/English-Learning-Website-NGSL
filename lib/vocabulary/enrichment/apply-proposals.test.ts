import { describe, expect, test } from "vitest";
import { applyVocabularyProposals } from "./apply-proposals";
import { vocabularyRecordFixture } from "../test-fixtures";
import type { VocabularyRecord } from "../schema";

function recordFor(lemma: string, options: Partial<VocabularyRecord> = {}): VocabularyRecord {
  return {
    ...vocabularyRecordFixture(),
    lemma,
    display: lemma,
    connections: [],
    ...options,
  };
}

describe("applyVocabularyProposals", () => {
  test("adds an unreviewed LLM connection to an existing word", () => {
    const result = applyVocabularyProposals(
      [recordFor("buy"), recordFor("purchase")],
      [{
        kind: "connection",
        lemma: "buy",
        target: "purchase",
        type: "advanced_form",
        gloss: "A more formal word for buying.",
        sourceId: "llm",
      }],
    );

    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]).toMatchObject({
      lemma: "buy",
      connections: [{
        target: "purchase",
        type: "advanced_form",
        gloss: "A more formal word for buying.",
        sources: [{ sourceId: "llm" }],
        status: "unreviewed",
      }],
    });
    expect(result.rejected).toEqual([]);
  });

  test("is idempotent for repeated connection proposals", () => {
    const proposal = {
      kind: "connection" as const,
      lemma: "buy",
      target: "purchase",
      type: "advanced_form" as const,
      gloss: "A more formal word for buying.",
      sourceId: "llm" as const,
    };
    const first = applyVocabularyProposals([recordFor("buy"), recordFor("purchase")], [proposal]);
    const second = applyVocabularyProposals(first.records, [proposal]);

    expect(second.changed).toEqual([]);
    expect(second.rejected).toEqual([]);
  });

  test("rejects an unknown connection target", () => {
    const result = applyVocabularyProposals(
      [recordFor("buy")],
      [{
        kind: "connection",
        lemma: "buy",
        target: "procure",
        type: "advanced_form",
        gloss: "A formal word for buying.",
        sourceId: "llm",
      }],
    );

    expect(result.rejected).toContainEqual({
      lemma: "buy", reason: "unknown target: procure",
    });
  });

  test("reports an unknown target before rejecting its blank gloss", () => {
    const result = applyVocabularyProposals(
      [recordFor("buy")],
      [{
        kind: "connection",
        lemma: "buy",
        target: "procure",
        type: "advanced_form",
        gloss: "   ",
        sourceId: "llm",
      }],
    );

    expect(result.rejected).toContainEqual({
      lemma: "buy", reason: "unknown target: procure",
    });
    expect(result.rejected).not.toContainEqual({
      lemma: "buy", reason: "blank gloss",
    });
  });

  test("rejects malformed or untrusted connection proposals", () => {
    const records = [recordFor("buy"), recordFor("purchase")];
    const result = applyVocabularyProposals(records, [
      {
        kind: "connection",
        lemma: "sell",
        target: "purchase",
        type: "synonym",
        gloss: "Related in a different way.",
        sourceId: "llm",
      },
      {
        kind: "connection",
        lemma: "buy",
        target: "purchase",
        type: "synonym",
        gloss: "   ",
        sourceId: "llm",
      },
      {
        kind: "connection",
        lemma: "buy",
        target: "purchase",
        type: "related",
        gloss: "Not a schema edge type.",
        sourceId: "llm",
      } as never,
      {
        kind: "connection",
        lemma: "buy",
        target: "purchase",
        type: "synonym",
        gloss: "A relation from the wrong source.",
        sourceId: "wordnet",
      } as never,
    ]);

    expect(result.changed).toEqual([]);
    expect(result.rejected).toEqual(expect.arrayContaining([
      { lemma: "sell", reason: "unknown lemma" },
      { lemma: "buy", reason: "blank gloss" },
      { lemma: "buy", reason: "unsupported connection type: related" },
      { lemma: "buy", reason: "unsupported source: wordnet" },
    ]));
  });

  test("does not overwrite a verified definition", () => {
    const verified = recordFor("buy", {
      status: "verified",
      senses: [{ ...vocabularyRecordFixture().senses[0], definition: "to pay money for something" }],
    });
    const result = applyVocabularyProposals(
      [verified],
      [{ kind: "definition", lemma: "buy", definition: "to get something by paying for it", sourceId: "llm" }],
    );

    expect(result.changed).toEqual([]);
    expect(result.records[0]?.senses[0]?.definition).toBe("to pay money for something");
    expect(result.rejected).toContainEqual({ lemma: "buy", reason: "verified definition" });
  });
});
