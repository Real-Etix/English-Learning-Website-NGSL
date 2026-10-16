import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { vocabularyRecordFixture } from "./test-fixtures";
import { applyLimitedRelease } from "./limited-release";
import { claimReadiness } from "./claim-readiness";
import { VocabularyRecordSchema } from "./schema";

function candidate() {
  const record = vocabularyRecordFixture();
  record.tier = "advanced";
  record.publicationStatus = "hidden";
  record.connections.forEach(c => c.status = "unreviewed");
  record.senses[0]!.status = "review";
  record.senses[0]!.examples = [];
  record.senses.push({ ...record.senses[0]!, id: "uncertain", definition: "Uncertain draft preserved verbatim.", sources: [{ ...record.sources[0]!, sourceId: "llm" }] });
  return record;
}
function decision(record = candidate()) {
  return { beforeHash: createHash("sha256").update(JSON.stringify(record)).digest("hex"), senseId: record.senses[0]!.id,
    reason: "Exact factual meaning reviewed against learning scope.", reviewedAt: "2026-10-16T00:00:00.000Z" };
}
describe("applyLimitedRelease", () => {
  it("publishes only the reviewed sense, preserves source text and leaves relationships unreviewed", () => {
    const record = candidate();
    const result = applyLimitedRelease(record, decision(record));
    expect(result.publicationStatus).toBe("published");
    expect(result.senses.map(s => s.status)).toEqual(["published", "hidden"]);
    expect(result.senses.map(s => s.definition)).toEqual(record.senses.map(s => s.definition));
    expect(result.sources).toEqual(record.sources);
    expect(result.connections).toEqual(record.connections);
    expect(claimReadiness(VocabularyRecordSchema.parse(result), result.senses[0]!.id).canClaim).toBe(true);
    expect(record.publicationStatus).toBe("hidden");
  });
  it("is idempotent after a successful apply", () => {
    const record = candidate(); const review = decision(record);
    const result = applyLimitedRelease(record, review);
    expect(applyLimitedRelease(result, review)).toEqual(result);
  });
  it("rejects changed inputs, core records, archives, missing senses and unattributable evidence", () => {
    for (const kind of ["changed", "core", "archive", "missing", "ai", "unattributed"] as const) {
      const record = candidate(); const review = decision(record);
      if (kind === "changed") record.display = "edited";
      if (kind === "core") record.tier = "core";
      if (kind === "archive") record.editorial = { scope: { status: "archived", lists: [], reason: "off topic", reviewedAt: review.reviewedAt } };
      if (kind === "missing") review.senseId = "absent";
      if (kind === "ai") record.senses[0]!.sources[0]!.sourceId = "llm";
      if (kind === "unattributed") record.senses[0]!.sources[0]!.url = null;
      expect(() => applyLimitedRelease(record, review)).toThrow();
    }
  });
});
