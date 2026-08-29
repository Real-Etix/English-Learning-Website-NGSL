import { describe, expect, test } from "vitest";

import type { WordDetail } from "../../content/word-detail";
import { dictionarySenseId } from "../enrichment/dictionary-import";
import { publicationStatusFor } from "../publication";
import type { VocabularyConnection, VocabularyRecord } from "../schema";
import { vocabularyRecordFixture } from "../test-fixtures";
import { applyVerificationOutcomes, type CandidateVerificationOutcome } from "./mutation";
import type { FactualDictionaryEvidence } from "./provider-types";
import type { AnchorDecision } from "./relationship-verifier";

const candidateGlosses = {
  examine: "\tBuilds  on examine — carefully!  ",
  inspect: "Builds on inspect; with greater intensity.",
  study: "Builds on study → close analysis.",
} as const;

const coreGlosses = {
  examine: "  Advanced\tform: scrutinise → examine. ",
  inspect: "Advanced form of inspect — scrutinise.",
  study: "Advanced form of study: scrutinise.",
} as const;

function sourceRef(sourceId: "llm" | "wordnet" | "tatoeba", suffix: string) {
  return {
    sourceId,
    externalId: suffix,
    url: sourceId === "llm" ? null : `https://${sourceId}.example/${suffix}`,
    retrievedAt: "2026-08-24T00:00:00.000Z",
    contentHash: `sha256:${sourceId}-${suffix}`,
  };
}

function connection(
  target: string,
  type: "builds_on" | "advanced_form",
  gloss: string,
  status: VocabularyConnection["status"] = "published",
): VocabularyConnection {
  return {
    target,
    type,
    gloss,
    sources: [sourceRef("llm", `${target}-${type}`)],
    status,
  };
}

function core(lemma: keyof typeof coreGlosses): VocabularyRecord {
  const fixture = vocabularyRecordFixture();
  return {
    ...fixture,
    lemma,
    display: lemma,
    tier: "core",
    publicationStatus: "published",
    connections: [connection("scrutinise", "advanced_form", coreGlosses[lemma])],
  };
}

function candidate(): VocabularyRecord {
  const fixture = vocabularyRecordFixture();
  return {
    ...fixture,
    lemma: "scrutinise",
    display: "scrutinise",
    tier: "advanced",
    partOfSpeech: "verb",
    forms: ["scrutinises", "scrutinised", "scrutinising"],
    status: "seeded",
    publicationStatus: "hidden",
    sources: [sourceRef("llm", "scrutinise")],
    senses: [{
      ...fixture.senses[0]!,
      id: "scrutinise-legacy-llm",
      definition: "An older generated draft.",
      sources: [sourceRef("llm", "scrutinise-sense")],
      examples: [],
      status: "published",
    }],
    pronunciation: [],
    connections: (Object.keys(candidateGlosses) as Array<keyof typeof candidateGlosses>)
      .map((lemma) => connection(lemma, "builds_on", candidateGlosses[lemma])),
  };
}

function dictionaryDetail(withSelectedExample = true): WordDetail {
  return {
    ipa: "/ˈskruː.tɪ.naɪz/",
    audioUk: null,
    audioUs: null,
    audioAny: null,
    sourceEntryId: "scrutinise-entry",
    sourceUrl: "https://wordnet.example/scrutinise",
    senses: [
      {
        partOfSpeech: "verb",
        definition: "To examine something with very careful attention.",
        example: withSelectedExample ? "She scrutinised every figure." : null,
        sourceSenseId: "scrutinise.v.01",
        sourceUrl: "https://wordnet.example/scrutinise#v1",
      },
      {
        partOfSpeech: "verb",
        definition: "To inspect something closely for faults.",
        example: "They scrutinised the contract.",
        sourceSenseId: "scrutinise.v.02",
        sourceUrl: "https://wordnet.example/scrutinise#v2",
      },
    ],
    synonyms: ["examine"],
  };
}

function evidence(withSelectedExample = true): FactualDictionaryEvidence {
  return {
    provider: "wordnet",
    returnedLemma: "scrutinise",
    requestedPartOfSpeech: "verb",
    detail: dictionaryDetail(withSelectedExample),
    source: {
      sourceId: "wordnet",
      url: null,
      retrievedAt: "2026-08-24T00:00:00.000Z",
      contentHash: "sha256:wordnet-scrutinise",
    },
  };
}

function selectedSenseId(record: VocabularyRecord, factualEvidence = evidence()): string {
  return dictionarySenseId(
    record,
    factualEvidence.detail,
    factualEvidence.detail.senses[0]!,
    factualEvidence.source.sourceId,
  );
}

function relationship(
  coreLemma: keyof typeof coreGlosses,
  decision: AnchorDecision["decision"],
): AnchorDecision {
  return {
    coreLemma,
    candidateType: "builds_on",
    coreType: "advanced_form",
    candidateGloss: candidateGlosses[coreLemma],
    coreGloss: coreGlosses[coreLemma],
    decision,
    method: decision === "supported" ? "direct_lexical" : "llm_consensus",
    reason: decision === "supported"
      ? null
      : decision === "unsupported"
        ? "relationship_unsupported"
        : "relationship_ambiguous",
  };
}

function snapshot(): VocabularyRecord[] {
  return [candidate(), core("examine"), core("inspect"), core("study")];
}

function passingOutcome(overrides: Partial<CandidateVerificationOutcome> = {}): CandidateVerificationOutcome {
  const record = candidate();
  const factualEvidence = evidence();
  return {
    candidateLemma: record.lemma,
    dictionaryEvidence: [factualEvidence],
    selectedExample: null,
    selectedSenseId: selectedSenseId(record, factualEvidence),
    relationships: [
      relationship("examine", "supported"),
      relationship("inspect", "ambiguous"),
      relationship("study", "unsupported"),
    ],
    reason: "published",
    ...overrides,
  };
}

function statusFor(record: VocabularyRecord, target: string): VocabularyConnection["status"] | undefined {
  return record.connections.find((item) => item.target === target)?.status;
}

describe("applyVerificationOutcomes", () => {
  test("publishes a passing sense and symmetrically applies every reciprocal decision", () => {
    const original = snapshot();
    const originalJson = JSON.stringify(original);
    const outcome = passingOutcome();

    const result = applyVerificationOutcomes(original, [outcome]);
    const changedCandidate = result.snapshot.find((record) => record.lemma === "scrutinise")!;
    const examine = result.snapshot.find((record) => record.lemma === "examine")!;
    const inspect = result.snapshot.find((record) => record.lemma === "inspect")!;
    const study = result.snapshot.find((record) => record.lemma === "study")!;

    expect(JSON.stringify(original)).toBe(originalJson);
    expect(changedCandidate).toMatchObject({
      status: "enriched",
      publicationStatus: "published",
    });
    expect(changedCandidate.senses.find((sense) => sense.id === outcome.selectedSenseId)?.status)
      .toBe("published");
    expect(changedCandidate.senses.find((sense) => sense.id === "scrutinise-legacy-llm")?.status)
      .toBe("hidden");
    expect(changedCandidate.senses.filter((sense) =>
      sense.sources.some((source) => source.sourceId === "wordnet")
      && sense.id !== outcome.selectedSenseId,
    ).map((sense) => sense.status)).toEqual(["review"]);

    expect(statusFor(changedCandidate, "examine")).toBe("published");
    expect(statusFor(examine, "scrutinise")).toBe("published");
    expect(statusFor(changedCandidate, "inspect")).toBe("unreviewed");
    expect(statusFor(inspect, "scrutinise")).toBe("unreviewed");
    expect(statusFor(changedCandidate, "study")).toBe("unreviewed");
    expect(statusFor(study, "scrutinise")).toBe("unreviewed");
    expect(changedCandidate.connections.map(({ target, gloss }) => ({ target, gloss }))).toEqual([
      { target: "examine", gloss: candidateGlosses.examine },
      { target: "inspect", gloss: candidateGlosses.inspect },
      { target: "study", gloss: candidateGlosses.study },
    ]);
    expect(examine.connections[0]?.gloss).toBe(coreGlosses.examine);
    expect(publicationStatusFor(changedCandidate, result.snapshot)).toBe("published");
    expect(result.publishedLemmas).toEqual(["scrutinise"]);
    expect(result.downgradedRelationshipCount).toBe(2);
  });

  test("keeps imported facts reviewable and the candidate hidden when verification does not pass", () => {
    const original = snapshot();
    const factualEvidence = evidence(false);
    const outcome = passingOutcome({
      dictionaryEvidence: [factualEvidence],
      selectedSenseId: null,
      relationships: [
        relationship("examine", "supported"),
        relationship("inspect", "ambiguous"),
        relationship("study", "unsupported"),
      ],
      reason: "no_sourced_example",
    });

    const result = applyVerificationOutcomes(original, [outcome]);
    const changedCandidate = result.snapshot[0]!;

    expect(changedCandidate.publicationStatus).toBe("hidden");
    expect(changedCandidate.status).toBe("enriched");
    expect(changedCandidate.senses.filter((sense) =>
      sense.sources.some((source) => source.sourceId === "wordnet"),
    ).map((sense) => sense.status)).toEqual(["review", "review"]);
    expect(result.publishedLemmas).toEqual([]);
    expect(result.downgradedRelationshipCount).toBe(2);
  });

  test("is idempotent and reports no updates on an already-applied snapshot", () => {
    const original = snapshot();
    const outcome = passingOutcome();
    const first = applyVerificationOutcomes(original, [outcome]);
    const repeated = applyVerificationOutcomes(first.snapshot, [outcome]);

    expect(repeated.snapshot).toEqual(first.snapshot);
    expect(repeated.updates).toEqual([]);
    expect(repeated.publishedLemmas).toEqual(["scrutinise"]);
    expect(repeated.downgradedRelationshipCount).toBe(0);
  });

  test("rejects duplicate outcomes, missing records, and reciprocal identity mismatches", () => {
    const outcome = passingOutcome();
    expect(() => applyVerificationOutcomes(snapshot(), [outcome, outcome]))
      .toThrow(/duplicate candidate outcome/i);
    expect(() => applyVerificationOutcomes(snapshot(), [{ ...outcome, candidateLemma: "missing" }]))
      .toThrow(/missing candidate/i);
    expect(() => applyVerificationOutcomes(snapshot(), [{
      ...outcome,
      relationships: [{ ...outcome.relationships[0]!, candidateGloss: "rewritten gloss" }],
    }])).toThrow(/reciprocal/i);
    expect(() => applyVerificationOutcomes(snapshot(), [{
      ...outcome,
      relationships: [{ ...outcome.relationships[0]!, coreLemma: "missing" }],
    }])).toThrow(/missing core/i);
  });

  test("never creates an absent connection or publishes without all final gates", () => {
    const outcome = passingOutcome();
    const withoutCandidateConnection = snapshot();
    withoutCandidateConnection[0] = {
      ...withoutCandidateConnection[0]!,
      connections: withoutCandidateConnection[0]!.connections.filter((item) => item.target !== "examine"),
    };

    expect(() => applyVerificationOutcomes(withoutCandidateConnection, [outcome]))
      .toThrow(/reciprocal/i);
    expect(() => applyVerificationOutcomes(snapshot(), [{
      ...outcome,
      selectedSenseId: "missing-selected-sense",
    }])).toThrow(/selected sense/i);
    expect(() => applyVerificationOutcomes(snapshot(), [{
      ...outcome,
      relationships: outcome.relationships.map((item) => ({
        ...item,
        decision: "ambiguous" as const,
        method: "llm_disagreement" as const,
        reason: "relationship_ambiguous" as const,
      })),
    }])).toThrow(/publication/i);
    expect(() => applyVerificationOutcomes(snapshot(), [{
      ...outcome,
      relationships: [],
    }])).toThrow(/supported reciprocal/i);
    expect(() => applyVerificationOutcomes(snapshot(), [{
      ...outcome,
      relationships: [relationship("examine", "supported")],
    }])).toThrow(/complete reciprocal/i);
  });

  test("requires the selected sense to belong to the supplied dictionary evidence", () => {
    const records = snapshot();
    const preexisting = {
      ...records[0]!.senses[0]!,
      id: "preexisting-tatoeba-sense",
      definition: "A caller-authored definition that is not dictionary evidence.",
      sources: [sourceRef("tatoeba", "preexisting-definition")],
      examples: [{
        text: "She scrutinised the report.",
        sources: [sourceRef("tatoeba", "preexisting-example")],
      }],
      status: "review" as const,
    };
    records[0] = { ...records[0]!, senses: [...records[0]!.senses, preexisting] };

    expect(() => applyVerificationOutcomes(records, [passingOutcome({
      dictionaryEvidence: [],
      selectedSenseId: preexisting.id,
    })])).toThrow(/dictionary evidence/i);
  });

  test("validates the complete input and proposed snapshot before returning updates", () => {
    const malformed = snapshot();
    malformed[2] = { ...malformed[2]!, display: "" } as VocabularyRecord;

    expect(() => applyVerificationOutcomes(malformed, [passingOutcome()])).toThrow();
    expect(() => applyVerificationOutcomes([
      ...snapshot(),
      { ...core("examine"), display: "duplicate examine" },
    ], [passingOutcome()])).toThrow(/duplicate lemma/i);
  });
});
