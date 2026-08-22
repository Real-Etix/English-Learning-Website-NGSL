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
});
