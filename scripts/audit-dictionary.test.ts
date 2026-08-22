import { describe, expect, it } from "vitest";

import { strictAuditBaselineFromManifest } from "./audit-dictionary";

const strict = {
  publishedPlaceholders: 0,
  publishedUnsupportedSenses: 0,
  claimableSensesWithoutSourcedExamples: 0,
  publishedConnectionsToHiddenOrMissingTargets: 0,
  learnerConnectionsWithoutGloss: 0,
};

describe("strictAuditBaselineFromManifest", () => {
  it("requires strict counts and a deterministic strict-violation identity list", () => {
    const strictWithPlaceholder = { ...strict, publishedPlaceholders: 1 };
    expect(strictAuditBaselineFromManifest({ total: { strict: strictWithPlaceholder }, strictViolations: ["published-placeholder:[\"anchor\",\"anchor-sense\"]"] })).toEqual({
      strict: strictWithPlaceholder,
      strictViolations: ["published-placeholder:[\"anchor\",\"anchor-sense\"]"],
    });
  });

  it.each([
    {},
    { total: { strict } },
    { total: { strict: { ...strict, publishedPlaceholders: -1 } }, strictViolations: [] },
    { total: { strict }, strictViolations: ["valid", 7] },
    { total: { strict }, strictViolations: ["b", "a"] },
    { total: { strict }, strictViolations: ["duplicate", "duplicate"] },
    { total: { strict: { ...strict, publishedPlaceholders: 1 } }, strictViolations: [] },
    { total: { strict: { ...strict, publishedPlaceholders: 1 } }, strictViolations: ["published-placeholder:not-json"] },
  ])("rejects malformed base audit manifests", (manifest) => {
    expect(() => strictAuditBaselineFromManifest(manifest)).toThrow("Base audit manifest");
  });
});
