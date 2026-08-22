import { describe, expect, it } from "vitest";
import { VocabularyRecordSchema } from "./schema";
import { vocabularyRecordFixture } from "./test-fixtures";

describe("VocabularyRecordSchema", () => {
  it("accepts a complete v1 record and rejects an invalid publication state", () => {
    expect(VocabularyRecordSchema.safeParse(vocabularyRecordFixture()).success).toBe(true);
    expect(VocabularyRecordSchema.safeParse({
      ...vocabularyRecordFixture(), publicationStatus: "visible",
    }).success).toBe(false);
  });

  it("rejects non-normalized record lemmas", () => {
    expect(VocabularyRecordSchema.safeParse({
      ...vocabularyRecordFixture(),
      lemma: " Learn ",
    }).success).toBe(false);
  });

  it("rejects non-normalized connection targets", () => {
    expect(VocabularyRecordSchema.safeParse({
      ...vocabularyRecordFixture(),
      connections: [{
        ...vocabularyRecordFixture().connections[0],
        target: " Study ",
      }],
    }).success).toBe(false);
  });

  it("rejects invalid list rank and SFI values", () => {
    const record = vocabularyRecordFixture();

    expect(VocabularyRecordSchema.safeParse({
      ...record,
      lists: [{ ...record.lists[0], rank: 0 }],
    }).success).toBe(false);
    expect(VocabularyRecordSchema.safeParse({
      ...record,
      lists: [{ ...record.lists[0], sfi: 101 }],
    }).success).toBe(false);
  });

  it("rejects unknown keys in nested persisted objects", () => {
    const record = vocabularyRecordFixture();

    expect(VocabularyRecordSchema.safeParse({
      ...record,
      sources: [{ ...record.sources[0], extra: true }],
    }).success).toBe(false);
    expect(VocabularyRecordSchema.safeParse({
      ...record,
      connections: [{ ...record.connections[0], extra: true }],
    }).success).toBe(false);
  });

  it("rejects invalid source identifiers and timestamps", () => {
    const record = vocabularyRecordFixture();

    expect(VocabularyRecordSchema.safeParse({
      ...record,
      sources: [{ ...record.sources[0], sourceId: "Fixture Source" }],
    }).success).toBe(false);
    expect(VocabularyRecordSchema.safeParse({
      ...record,
      sources: [{ ...record.sources[0], retrievedAt: "not-a-timestamp" }],
    }).success).toBe(false);
  });

  it("rejects invalid connection types", () => {
    const record = vocabularyRecordFixture();

    expect(VocabularyRecordSchema.safeParse({
      ...record,
      connections: [{ ...record.connections[0], type: "related" }],
    }).success).toBe(false);
  });
});
