import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findMisplacedShardFindings } from "./lint-vocabulary";
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
