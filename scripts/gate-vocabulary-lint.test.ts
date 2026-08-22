import { describe, expect, it } from "vitest";

import {
  compareVocabularyLintReports,
  parseVocabularyLintReport,
  validateVocabularyLintExit,
} from "./gate-vocabulary-lint";

function report(findings: Array<{ level: "error" | "warn"; lemma: string; message: string }>) {
  return { version: 1, records: 2, findings };
}

describe("vocabulary lint regression gate", () => {
  it("allows unchanged inherited errors and rejects a new error identity", () => {
    const base = parseVocabularyLintReport(report([
      { level: "error", lemma: "anchor", message: "inherited error" },
      { level: "warn", lemma: "anchor", message: "editorial warning" },
    ]));
    const unchanged = parseVocabularyLintReport(report([
      { level: "warn", lemma: "anchor", message: "editorial warning" },
      { level: "error", lemma: "anchor", message: "inherited error" },
    ]));
    const regressed = parseVocabularyLintReport(report([
      { level: "error", lemma: "anchor", message: "inherited error" },
      { level: "error", lemma: "beta", message: "new error" },
    ]));

    expect(compareVocabularyLintReports(unchanged, base)).toEqual([]);
    expect(compareVocabularyLintReports(regressed, base)).toEqual(["error:[\"beta\",\"new error\"]"]);
  });

  it.each([
    null,
    {},
    { version: 2, records: 0, findings: [] },
    { version: 1, records: -1, findings: [] },
    { version: 1, records: 0, findings: [{ level: "info", lemma: "anchor", message: "bad" }] },
  ])("rejects malformed lint JSON", (value) => {
    expect(() => parseVocabularyLintReport(value)).toThrow("Vocabulary lint report");
  });

  it("requires the lint exit code to agree with the report's error findings", () => {
    expect(() => validateVocabularyLintExit(parseVocabularyLintReport(report([])), 1)).toThrow("crashed or reported inconsistent");
    expect(() => validateVocabularyLintExit(parseVocabularyLintReport(report([
      { level: "error", lemma: "anchor", message: "inherited error" },
    ])), 0)).toThrow("crashed or reported inconsistent");
    expect(() => validateVocabularyLintExit(parseVocabularyLintReport(report([])), 0)).not.toThrow();
  });
});
