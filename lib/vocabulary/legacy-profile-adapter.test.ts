import { describe, expect, it } from "vitest";

import { toLegacyPage } from "./legacy-profile-adapter";
import type { VocabularyRecord } from "./schema";
import { vocabularyRecordFixture } from "./test-fixtures";

describe("legacy vocabulary page projection", () => {
  it("exposes only published, glossed connections to known published targets without changing their gloss bytes", () => {
    const record = vocabularyRecordFixture();
    const [valid] = record.connections;
    const authoredGloss = "  Keep this authored wording exactly.  ";
    const source: VocabularyRecord = {
      ...record,
      connections: [
        { ...valid!, target: "published-target", gloss: authoredGloss, status: "published" as const },
        { ...valid!, target: "draft-link", gloss: "draft guidance", status: "unreviewed" },
        { ...valid!, target: "empty-link", gloss: " ", status: "published" },
        { ...valid!, target: "missing-target", gloss: "missing target", status: "published" },
        { ...valid!, target: "hidden-target", gloss: "hidden target", status: "published" },
      ],
    };
    const page = toLegacyPage(source, [
      source,
      { ...record, lemma: "published-target", display: "published-target", publicationStatus: "published" },
      { ...record, lemma: "hidden-target", display: "hidden-target", publicationStatus: "hidden" },
    ]);

    expect(page.connections).toEqual([{ type: valid!.type, target: "published-target", gloss: authoredGloss }]);
  });
});
