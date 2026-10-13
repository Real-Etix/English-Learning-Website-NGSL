import { expect, test } from "vitest";
import { vocabularyRecordFixture } from "../test-fixtures";
import { claimReadiness } from "../claim-readiness";
import { parseQualityDecision, quarantineRecoveredSense, QUALITY_PROMPT, editorialAction } from "./recovery-quality";

test("requires an explicit error classification and explanation", () => {
  expect(parseQualityDecision({ issue: "none", reason: "The example uses the supplied meaning." })?.issue).toBe("none");
  for (const v of [null, {}, { issue: "none" }, { issue: "none", reason: "" }, { issue: "invented", reason: "x" }, { issue: "none", reason: "x", extra: true }]) expect(parseQualityDecision(v)).toBeNull();
  expect(parseQualityDecision({ issue: "sense_mismatch", reason: "Forecast reduction is not a price discount." })?.issue).toBe("sense_mismatch");
});
test("quarantine preserves words, sense text, IDs, attribution, lists and connections", () => {
  const before = { ...vocabularyRecordFixture(), tier: "advanced" as const };
  const sense = before.senses[0]!;
  const after = quarantineRecoveredSense(before, sense.id);
  expect(after.senses[0]).toEqual({ ...sense, status: "hidden" });
  expect(after.publicationStatus).toBe("hidden");
  expect(after.verificationStatus).toBe("ambiguous");
  expect(claimReadiness(after, sense.id).canClaim).toBe(false);
  for (const key of ["lemma", "display", "lists", "connections", "sources", "forms"] as const) expect(after[key]).toEqual(before[key]);
  expect(quarantineRecoveredSense(after, sense.id)).toEqual(after);
});
test("core words remain searchable but the rejected sense cannot be claimed", () => {
  const before = vocabularyRecordFixture();
  const after = quarantineRecoveredSense(before, before.senses[0]!.id);
  expect(after.publicationStatus).toBe("published");
  expect(claimReadiness(after, before.senses[0]!.id).canClaim).toBe(false);
  expect(() => quarantineRecoveredSense(before, "missing")).toThrow("Missing");
});
test("the critic checks exact semantic constraints and definition grammar without generating replacements", () => {
  expect(QUALITY_PROMPT).toMatch(/json/i);
  expect(QUALITY_PROMPT).toContain("price");
  expect(QUALITY_PROMPT).toContain("definition itself");
  expect(QUALITY_PROMPT).toContain("Function words");
  expect(QUALITY_PROMPT).toContain("Do not rewrite");
});
test("a model flag never determines publication without an exact agent decision", () => {
  const flag = { issue: "definition_quality", reason: "Possibly incomplete." };
  expect(() => editorialAction("masterwork", "hash", flag)).toThrow("Editorial review required");
  const keep = { lemma: "masterwork", recordHash: "hash", reviewer: "agent", action: "keep", reason: "The dictionary meaning is complete and the example has a finite main clause." };
  expect(editorialAction("masterwork", "hash", flag, keep)).toBe("keep");
  expect(editorialAction("masterwork", "hash", flag, { ...keep, action: "quarantine" })).toBe("quarantine");
  for (const change of [{ recordHash: "stale" }, { lemma: "different" }, { reason: " " }, { reviewer: "model" }, { action: "publish" }]) expect(() => editorialAction("masterwork", "hash", flag, { ...keep, ...change })).toThrow();
});
test("agent review can catch a problem the model missed", () => {
  const unflagged = { issue: "none", reason: "No defect detected." };
  expect(editorialAction("word", "hash", unflagged)).toBe("keep");
  expect(editorialAction("word", "hash", unflagged, { lemma: "word", recordHash: "hash", reviewer: "agent", action: "quarantine", reason: "Example uses another meaning." })).toBe("quarantine");
  expect(() => editorialAction("word", "hash", { issue: "none" })).toThrow();
});
