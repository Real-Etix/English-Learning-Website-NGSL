import { describe, expect, test } from "vitest";

import { vocabularyRecordFixture } from "../test-fixtures";
import type { VocabularyRecord } from "../schema";
import { VerificationReasonCodeSchema } from "./types";
import { selectAdvancedVerificationCandidates } from "./candidate-selector";

function record(
  lemma: string,
  overrides: Partial<VocabularyRecord> = {},
): VocabularyRecord {
  return {
    ...vocabularyRecordFixture(),
    lemma,
    display: lemma,
    connections: [],
    ...overrides,
  };
}

function connection(
  target: string,
  type: "advanced_form" | "builds_on",
  gloss: string | null = `${type} ${target}`,
  status: "published" | "unreviewed" | "hidden" = "published",
) {
  return {
    ...vocabularyRecordFixture().connections[0]!,
    target,
    type,
    gloss,
    status,
  } as const;
}

function coreRecord(
  lemma: string,
  advancedTargets: string[],
): VocabularyRecord {
  return record(lemma, {
    tier: "core",
    publicationStatus: "published",
    connections: advancedTargets.map((target) => connection(target, "advanced_form")),
  });
}

function advancedRecord(
  lemma: string,
  coreTargets: string[],
  overrides: Partial<VocabularyRecord> = {},
): VocabularyRecord {
  return record(lemma, {
    tier: "advanced",
    publicationStatus: "hidden",
    connections: coreTargets.map((target) => connection(target, "builds_on")),
    ...overrides,
  });
}

describe("selectAdvancedVerificationCandidates", () => {
  test("ranks hidden advanced records by incoming value, core anchors, then lemma", () => {
    const records: VocabularyRecord[] = [
      coreRecord("assess", ["scrutinize", "manifest", "discern"]),
      coreRecord("observe", ["scrutinize", "manifest"]),
      coreRecord("inspect", ["scrutinize"]),
      coreRecord("review", ["scrutinize", "manifest", "discern"]),
      advancedRecord("scrutinize", ["assess", "observe", "inspect"]),
      advancedRecord("manifest", ["assess", "observe"]),
      advancedRecord("discern", ["assess"]),
      advancedRecord("scrutinize", ["assess", "observe", "inspect"]),
    ];

    const selected = selectAdvancedVerificationCandidates(records, 3);

    expect(selected.map((candidate) => candidate.record.lemma)).toEqual([
      "scrutinize",
      "manifest",
      "discern",
    ]);
    expect(selected[0]).toMatchObject({
      incomingPublishedCount: 4,
      distinctPublishedCoreAnchors: 3,
    });
  });

  test("extracts one reciprocal anchor per core and preserves gloss bytes", () => {
    const candidateGloss = "  builds\ton   assess!  ";
    const coreGloss = "advanced form: assess → scrutinize  ";
    const core = record("assess", {
      tier: "core",
      publicationStatus: "published",
      connections: [connection("scrutinize", "advanced_form", coreGloss)],
    });
    const candidate = advancedRecord("scrutinize", [], {
      connections: [
        connection("assess", "builds_on", candidateGloss),
        connection("assess", "builds_on", "duplicate link"),
      ],
    });

    const [selected] = selectAdvancedVerificationCandidates([core, candidate], 1);

    expect(selected?.anchors).toEqual([{
      coreLemma: "assess",
      candidateType: "builds_on",
      coreType: "advanced_form",
      candidateGloss,
      coreGloss,
    }]);
    expect(selected?.distinctPublishedCoreAnchors).toBe(1);
  });

  test("excludes core, non-hidden, and non-advanced records", () => {
    const recordsWithIneligibleWords: VocabularyRecord[] = [
      coreRecord("core-word", ["scrutinize"]),
      record("published-advanced", { tier: "advanced", publicationStatus: "published" }),
      record("hidden-core", { tier: "core", publicationStatus: "hidden" }),
      record("draft-advanced", { tier: "advanced", publicationStatus: "draft" }),
      advancedRecord("scrutinize", []),
    ];

    expect(selectAdvancedVerificationCandidates(recordsWithIneligibleWords, 25)
      .map((candidate) => candidate.record.lemma)).toEqual(["scrutinize"]);
  });

  test("orders candidates by lemma when incoming and anchor counts tie", () => {
    const records = [
      coreRecord("core-word", ["zeta", "alpha"]),
      advancedRecord("zeta", ["core-word"]),
      advancedRecord("alpha", ["core-word"]),
    ];

    expect(selectAdvancedVerificationCandidates(records, 2)
      .map((candidate) => candidate.record.lemma)).toEqual(["alpha", "zeta"]);
  });

  test("rejects a negative or non-integer limit", () => {
    const records = [advancedRecord("scrutinize", [])];

    expect(() => selectAdvancedVerificationCandidates(records, -1)).toThrow(
      "limit must be a non-negative integer",
    );
    expect(() => selectAdvancedVerificationCandidates(records, 1.5)).toThrow(
      "limit must be a non-negative integer",
    );
  });

  test("exports the stable verification reason-code values", () => {
    expect(VerificationReasonCodeSchema.options).toEqual([
      "published",
      "no_factual_sense",
      "pos_mismatch",
      "no_sourced_example",
      "sense_ambiguous",
      "no_reciprocal_anchor",
      "relationship_unsupported",
      "relationship_ambiguous",
      "judge_unavailable",
      "provider_failed",
      "budget_exhausted",
    ]);
  });
});
