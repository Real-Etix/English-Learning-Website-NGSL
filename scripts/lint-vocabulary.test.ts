import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findMisplacedShardFindings, lintVocabularyRecords } from "./lint-vocabulary";
import { vocabularyRecordFixture } from "../lib/vocabulary/test-fixtures";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("findMisplacedShardFindings", () => {
  it("reports a canonical record stored in the wrong physical shard", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vocabulary-lint-"));
    roots.push(root);
    const record = vocabularyRecordFixture();
    await writeFile(path.join(root, "00.ndjson"), `${JSON.stringify(record)}\n`);

    await expect(findMisplacedShardFindings(root)).resolves.toEqual([
      expect.objectContaining({
        level: "error",
        lemma: "learn",
        message: expect.stringContaining("00.ndjson"),
      }),
    ]);
  });
});

describe("lintVocabularyRecords", () => {
  it("rejects published connections with blank glosses or non-public targets without rejecting unreviewed editorial debt", () => {
    const record = vocabularyRecordFixture();
    const [connection] = record.connections;
    const publicTarget = { ...record, lemma: "public-target", display: "public-target", publicationStatus: "published" as const };
    const hiddenTarget = { ...record, lemma: "hidden-target", display: "hidden-target", publicationStatus: "hidden" as const };
    const findings = lintVocabularyRecords([
      {
        ...record,
        connections: [
          { ...connection!, target: "public-target", status: "published", gloss: " " },
          { ...connection!, target: "hidden-target", status: "published", gloss: "authored wording" },
          { ...connection!, target: "missing-target", status: "published", gloss: "authored wording" },
          { ...connection!, target: "missing-target", status: "unreviewed", gloss: null },
        ],
      },
      publicTarget,
      hiddenTarget,
    ]);

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ lemma: record.lemma, message: expect.stringContaining("published connection to [[public-target]] needs a gloss") }),
      expect.objectContaining({ lemma: record.lemma, message: expect.stringContaining("published connection targets non-public word [[hidden-target]]") }),
      expect.objectContaining({ lemma: record.lemma, message: expect.stringContaining("published connection targets non-public word [[missing-target]]") }),
    ]));
    expect(findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ lemma: record.lemma, message: expect.stringContaining("unreviewed") }),
    ]));
  });
});
