import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { WordDetail } from "../lib/content/word-detail";
import { sourceForDictionaryDetail } from "./enrich-vocabulary";

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
    const script = path.resolve(process.cwd(), "scripts", "enrich-vocabulary.ts");
    const fixture = path.resolve(process.cwd(), "tests/fixtures/enrichment-source-backed.json");
    const result = spawnSync("npx", [
      "tsx",
      script,
      "--stage=advanced",
      "--limit=1",
      "--max-input-tokens=1",
      "--max-output-tokens=1",
      `--fixture=${fixture}`,
      "--dry-run",
    ], { cwd: process.cwd(), encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Budget exhausted");
    expect(result.stdout).toContain("Imported 0 factual sense(s)");
  });

  it("settles admitted fixture usage through TokenBudget and reports actual usage", () => {
    const script = path.resolve(process.cwd(), "scripts", "enrich-vocabulary.ts");
    const fixture = path.resolve(process.cwd(), "tests/fixtures/enrichment-source-backed.json");
    const reportDirectory = mkdtempSync(path.join(tmpdir(), "ngsl-task-7-report-"));
    const reportPath = path.join(reportDirectory, "report.json");
    try {
      const result = spawnSync("npx", [
        "tsx",
        script,
        "--stage=advanced",
        "--limit=1",
        "--max-input-tokens=1000000",
        "--max-output-tokens=1000",
        `--fixture=${fixture}`,
        "--dry-run",
        `--report=${reportPath}`,
      ], { cwd: process.cwd(), encoding: "utf8" });

      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(reportPath, "utf8"))).toMatchObject({
        tokenUsage: { inputTokens: 1, outputTokens: 1 },
      });
    } finally {
      rmSync(reportDirectory, { recursive: true, force: true });
    }
  });
});
