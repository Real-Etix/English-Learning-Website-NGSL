import { describe, expect, it } from "vitest";

import { publicConnections } from "./public-connections";
import { toGraphInput } from "./graph-input";
import { vocabularyRecordFixture } from "./test-fixtures";

function target(lemma: string, publicationStatus: "published" | "hidden" = "published") {
  const record = vocabularyRecordFixture();
  return { ...record, lemma, display: lemma, publicationStatus };
}

describe("publicConnections", () => {
  it("keeps only published, glossed connections to known published targets without changing the authored gloss", () => {
    const record = vocabularyRecordFixture();
    const [connection] = record.connections;
    const authoredGloss = "  Keep these authored bytes exactly.  ";
    const records = [
      record,
      target("published-target"),
      target("hidden-target", "hidden"),
    ];
    const source = {
      ...record,
      connections: [
        { ...connection!, target: "published-target", gloss: authoredGloss, status: "published" as const },
        { ...connection!, target: "published-target", gloss: " ", status: "published" as const },
        { ...connection!, target: "published-target", gloss: "draft wording", status: "unreviewed" as const },
        { ...connection!, target: "published-target", gloss: "hidden wording", status: "hidden" as const },
        { ...connection!, target: "missing-target", gloss: "unknown target", status: "published" as const },
        { ...connection!, target: "hidden-target", gloss: "hidden target", status: "published" as const },
      ],
    };

    expect(publicConnections(source, records)).toEqual([
      expect.objectContaining({ target: "published-target", gloss: authoredGloss, status: "published" }),
    ]);
  });

  it("keeps legacy unreviewed edges out of clustering unless the explicit migration option is enabled", () => {
    const record = vocabularyRecordFixture();
    const [connection] = record.connections;
    const targetRecord = target("legacy-target");
    const source = {
      ...record,
      connections: [{ ...connection!, target: "legacy-target", gloss: null, status: "unreviewed" as const }],
    };

    expect(toGraphInput(source, { records: [source, targetRecord] }).connections).toEqual([]);
    expect(toGraphInput(source, {
      records: [source, targetRecord],
      includeLegacyUnreviewedForClustering: true,
    }).connections).toEqual([{ target: "legacy-target", type: connection!.type }]);
  });
});
