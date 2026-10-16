import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { WordDetail } from "../lib/content/word-detail";
import { shardIdForLemma } from "../lib/vocabulary/shards";
import type { VocabularyRecord } from "../lib/vocabulary/schema";
import { vocabularyRecordFixture } from "../lib/vocabulary/test-fixtures";
import { sourceForDictionaryDetail } from "./enrich-vocabulary";

// Exercise the real CLI against an isolated hidden draft, not whichever words
// happen to remain unpublished in the developer's canonical library.
function runFixtureCli(args: string[]) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ngsl-enrichment-fixture-")));
  try {
    const record: VocabularyRecord = { ...vocabularyRecordFixture(), tier: "advanced", status: "seeded", publicationStatus: "hidden", lists: [], connections: [] };
    const corpus = path.join(root, "content", "vocabulary");
    mkdirSync(corpus, { recursive: true });
    writeFileSync(path.join(corpus, `${shardIdForLemma(record.lemma)}.ndjson`), `${JSON.stringify(record)}\n`);
    // Preserve the CLI entrypoint's cwd-relative invocation while resolving its
    // implementation and dependencies from the real project.
    symlinkSync(path.resolve("scripts"), path.join(root, "scripts"), "dir");
    return spawnSync(process.execPath, [
      "--import", createRequire(import.meta.url).resolve("tsx"),
      path.join(root, "scripts", "enrich-vocabulary.ts"),
      "--stage=advanced", "--limit=1",
      `--fixture=${path.resolve("tests/fixtures/enrichment-source-backed.json")}`,
      "--dry-run", ...args,
    ], { cwd: root, encoding: "utf8", timeout: 10000 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const fixtureDetail: WordDetail = {
  ipa: null,
  audioUk: null,
  audioUs: null,
  audioAny: null,
  sourceEntryId: "fixture-entry",
  sourceUrl: "https://example.com/fixture-entry",
  senses: [],
  synonyms: [],
};

describe("enrichment CLI fixture seams", () => {
  it("uses a deterministic null retrieval timestamp when a fixture omits source metadata", () => {
    expect(sourceForDictionaryDetail(fixtureDetail, null, true)).toEqual({
      sourceId: "dictionaryapi",
      url: "https://example.com/fixture-entry",
      retrievedAt: null,
      contentHash: null,
    });
  });

  it("stops before a fixture guidance request when the token budget is too small", () => {
    const result = runFixtureCli([
      "--max-input-tokens=1",
      "--max-output-tokens=1",
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Budget exhausted");
    expect(result.stdout).toContain("Imported 0 factual sense(s)");
  });

  it("settles admitted fixture usage through TokenBudget and reports actual usage", () => {
    const reportDirectory = mkdtempSync(path.join(tmpdir(), "ngsl-task-7-report-"));
    const reportPath = path.join(reportDirectory, "report.json");
    try {
      const result = runFixtureCli([
        "--max-input-tokens=1000000",
        "--max-output-tokens=1000",
        `--report=${reportPath}`,
      ]);

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(readFileSync(reportPath, "utf8"))).toMatchObject({
        tokenUsage: { inputTokens: 1, outputTokens: 1 },
      });
    } finally {
      rmSync(reportDirectory, { recursive: true, force: true });
    }
  });
});
