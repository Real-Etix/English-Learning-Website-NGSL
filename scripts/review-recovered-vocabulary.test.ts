import { expect, test } from "vitest";
import { parseReviewArgs, qualityReceiptKey } from "./review-recovered-vocabulary";
test("quality review requires an explicit write or calibration mode", () => {
  expect(parseReviewArgs([])).toBe("plan");
  expect(parseReviewArgs(["--pilot"])).toBe("pilot");
  expect(parseReviewArgs(["--flags"])).toBe("flags");
  expect(parseReviewArgs(["--apply"])).toBe("apply");
  for (const args of [["--write"], ["--pilot", "--flags"], ["--force"], ["--apply", "--apply"]]) expect(() => parseReviewArgs(args)).toThrow();
});
test("quality receipts bind to the exact record and prompt, not just a lemma", () => {
  const key = qualityReceiptKey("word", "record-hash", "prompt");
  expect(qualityReceiptKey("word", "record-hash", "prompt")).toBe(key);
  expect(qualityReceiptKey("word", "edited-hash", "prompt")).not.toBe(key);
  expect(qualityReceiptKey("word", "record-hash", "new-prompt")).not.toBe(key);
});
