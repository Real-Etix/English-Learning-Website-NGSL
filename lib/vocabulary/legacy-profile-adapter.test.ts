import { describe, expect, it } from "vitest";

import { toLegacyPage } from "./legacy-profile-adapter";
import { vocabularyRecordFixture } from "./test-fixtures";

describe("legacy vocabulary page projection", () => {
  it("exposes only published, glossed connections", () => {
    const record = vocabularyRecordFixture();
    const [valid] = record.connections;
    const page = toLegacyPage({
      ...record,
      connections: [
        valid!,
        { ...valid!, target: "draft-link", gloss: "draft guidance", status: "unreviewed" },
        { ...valid!, target: "empty-link", gloss: " ", status: "published" },
      ],
    });

    expect(page.connections).toEqual([{ type: valid!.type, target: valid!.target, gloss: valid!.gloss }]);
  });
});
