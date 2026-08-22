import { describe, expect, it } from "vitest";

import { verifyEnrichmentPaths } from "./verify-enrichment-diff";

describe("verifyEnrichmentPaths", () => {
  it("accepts canonical vocabulary and all regenerated graph artifacts", () => {
    expect(verifyEnrichmentPaths([
      "M\tcontent/vocabulary/03.ndjson",
      "M\tcontent/vocabulary/manifest.json",
      "M\tdata/generated/graphs/ngsl.json",
      "M\tdata/generated/vocabulary/manifest.json",
      "M\tdata/generated/vocabulary/words-03.json",
      "A\tpublic/generated/galaxy/assets/ngsl-chart-123.json",
      "D\tpublic/generated/galaxy/assets/ngsl-chart-stale.json",
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
});
