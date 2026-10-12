import { expect, test } from "vitest";
import { parseRecoveryArgs, pendingRecovery, recoveryReason, validateJournal, REVIEW_PROMPT, recoveryInfrastructureFailed } from "./recover-vocabulary";
test("requires an explicit write flag and rejects unrelated CLI options", () => {
  expect(parseRecoveryArgs([])).toEqual({ write: false, pilot: false, limit: Infinity });
  expect(parseRecoveryArgs(["--pilot", "--write", "--limit=25"])).toEqual({ write: true, pilot: true, limit: 25 });
  expect(() => parseRecoveryArgs(["--all=anything"])).toThrow();
  expect(() => parseRecoveryArgs(["--limit=0"])).toThrow();
});
test("resumes a pinned queue without repeating assessed records", () => {
  expect(pendingRecovery(["who", "may", "into"], { who: { reason: "recovered" }, may: { reason: "source_unavailable" } }, 25)).toEqual(["may", "into"]);
});
test("distinguishes missing meanings, examples, ambiguity and recovered content", () => {
  expect(recoveryReason(0, 0, false)).toBe("no_factual_sense");
  expect(recoveryReason(2, 0, false)).toBe("no_sourced_example");
  expect(recoveryReason(2, 1, false)).toBe("sense_ambiguous");
  expect(recoveryReason(2, 1, true)).toBe("recovered");
});
test("retries transient judge failures but never requeues withheld content", () => {
  expect(pendingRecovery(["a", "b", "c", "d"], {
    a: { reason: "judge_unavailable" }, b: { reason: "judge_invalid_response" },
    c: { reason: "sense_ambiguous" }, d: { reason: "budget_deferred" },
  }, 25)).toEqual(["a", "b"]);
});
test("replays a partially written batch only when records match before or after hashes", () => {
  const journal = [{ lemma: "who", beforeHash: "before", afterHash: "after" }];
  expect(() => validateJournal(journal, new Map([["who", "before"]]))).not.toThrow();
  expect(() => validateJournal(journal, new Map([["who", "after"]]))).not.toThrow();
  expect(() => validateJournal(journal, new Map([["who", "outside-edit"]]))).toThrow("changed");
  expect(() => validateJournal(journal, new Map())).toThrow("changed");
});
test("the independent reviewer satisfies the provider's JSON-mode prompt requirement", () => {
  expect(REVIEW_PROMPT).toMatch(/json/i);
  expect(REVIEW_PROMPT).toContain('"complete_sentence"');
});
test("stops a group after three provider failures without spending on the rest of the batch", () => {
  expect(recoveryInfrastructureFailed(["judge_unavailable", "judge_unavailable", "judge_unavailable"])).toBe(true);
  expect(recoveryInfrastructureFailed(["recovered", "no_factual_sense", "sense_ambiguous"])).toBe(false);
});
