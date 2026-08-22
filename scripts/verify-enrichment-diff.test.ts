import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { verifyEnrichmentPaths, verifyEnrichmentReport } from "./verify-enrichment-diff";

describe("verifyEnrichmentPaths", () => {
  it("accepts canonical vocabulary and all regenerated graph artifacts", () => {
    expect(verifyEnrichmentPaths([
      "M\tcontent/vocabulary/03.ndjson",
      "M\tcontent/vocabulary/manifest.json",
      "M\tdata/generated/graphs/ngsl.json",
      "M\tdata/generated/vocabulary/manifest.json",
      "M\tdata/generated/vocabulary/words-03.json",
      "M\tdata/generated/vocabulary/words-1f.json",
      "M\tpublic/generated/galaxy/manifests/ngsl.json",
      "A\tpublic/generated/galaxy/assets/ngsl-chart-0123456789ab.json",
      "A\tpublic/generated/galaxy/assets/ngsl-search-0123456789ab.json",
      "A\tpublic/generated/galaxy/assets/ngsl-full-0123456789ab.bin",
      "D\tpublic/generated/galaxy/assets/ngsl-chart-0123456789ab.json",
    ])).toEqual({ allowed: true, errors: [] });
  });

  it("rejects paths outside the enrichment outputs", () => {
    const result = verifyEnrichmentPaths([
      "M\t.env",
      "M\tapp/api/word/route.ts",
      "M\t.github/workflows/vocabulary-enrichment.yml",
      "M\tcontent/vocabulary/sources.json",
    ]);

    expect(result.allowed).toBe(false);
    expect(result.errors).toEqual([
      'disallowed path: .env',
      'disallowed path: app/api/word/route.ts',
      'disallowed path: .github/workflows/vocabulary-enrichment.yml',
      'disallowed path: content/vocabulary/sources.json',
    ]);
  });

  it("rejects deletion of canonical registries", () => {
    const result = verifyEnrichmentPaths([
      "D\tcontent/vocabulary/schema.json",
      "D\tcontent/vocabulary/sources.json",
      "D\tcontent/vocabulary/manifest.json",
    ]);

    expect(result).toEqual({
      allowed: false,
      errors: [
        'protected file cannot be deleted: content/vocabulary/schema.json',
        'protected file cannot be deleted: content/vocabulary/sources.json',
        'protected file cannot be deleted: content/vocabulary/manifest.json',
      ],
    });
  });

  it("allows only the exact generated word artifact names", () => {
    const result = verifyEnrichmentPaths([
      "M\tdata/generated/vocabulary/words-20.json",
      "M\tdata/generated/vocabulary/tmp.json",
      "M\tdata/generated/vocabulary/words-00.ndjson",
    ]);

    expect(result.allowed).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  it("rejects traversal, absolute, backslash, and dot-segment paths", () => {
    const result = verifyEnrichmentPaths([
      "M\tdata/generated/graphs/../../.env",
      "M\t/data/generated/graphs/ngsl.json",
      "M\tdata\\generated\\graphs\\ngsl.json",
      "M\tdata/generated/graphs/./ngsl.json",
      "M\tdata/generated/graphs/../graphs/ngsl.json",
    ]);

    expect(result.allowed).toBe(false);
    expect(result.errors).toHaveLength(5);
  });

  it("rejects malformed statuses and rename entries while preserving deletions", () => {
    const result = verifyEnrichmentPaths([
      "M data/generated/graphs/ngsl.json",
      "R100\tdata/generated/graphs/ngsl.json\tdata/generated/graphs/all.json",
      "X\tdata/generated/graphs/ngsl.json",
      "M\tdata/generated/graphs/ngsl.json\textra",
      "D\tcontent/vocabulary/manifest.json",
    ]);

    expect(result.allowed).toBe(false);
    expect(result.errors).toEqual([
      'malformed diff entry: "M data/generated/graphs/ngsl.json"',
      'malformed diff entry: "R100\\tdata/generated/graphs/ngsl.json\\tdata/generated/graphs/all.json"',
      'malformed diff entry: "X\\tdata/generated/graphs/ngsl.json"',
      'malformed diff entry: "M\\tdata/generated/graphs/ngsl.json\\textra"',
      'protected file cannot be deleted: content/vocabulary/manifest.json',
    ]);
    expect(verifyEnrichmentPaths(["D\tpublic/generated/galaxy/assets/ngsl-chart-0123456789ab.json"]).allowed).toBe(true);
  });

  it("reads changed paths from stdin and exits non-zero for a rejected path", () => {
    const script = path.resolve(process.cwd(), "scripts", "verify-enrichment-diff.ts");
    const valid = spawnSync("npx", ["tsx", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      input: "M\tdata/generated/vocabulary/manifest.json\n",
    });
    const invalid = spawnSync("npx", ["tsx", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      input: "M\tdata/generated/graphs/../../.env\n",
    });

    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain("Validated 1 enrichment change(s).");
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("repository-relative");
  });
});

describe("verifyEnrichmentReport", () => {
  it("accepts aggregate-only enrichment reports", () => {
    expect(verifyEnrichmentReport(JSON.stringify({
      stage: "advanced",
      factualImports: 2,
      reviewProposals: 3,
      hiddenRecords: 1,
      rejections: 4,
      unknownTargets: 2,
      tokenUsage: { inputTokens: 120, outputTokens: 80 },
      estimatedRemainingDebt: 9,
    }))).toEqual({ allowed: true, errors: [] });
  });

  it("rejects reports containing prompts, provider responses, or API keys", () => {
    const result = verifyEnrichmentReport(JSON.stringify({
      stage: "ngsl",
      factualImports: 0,
      reviewProposals: 0,
      hiddenRecords: 0,
      rejections: 0,
      unknownTargets: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      estimatedRemainingDebt: 0,
      prompt: "private prompt",
      response: { choices: [] },
      apiKey: "secret",
    }));

    expect(result.allowed).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "sensitive report field: prompt",
      "sensitive report field: response",
      "sensitive report field: apiKey",
    ]));
  });
});
