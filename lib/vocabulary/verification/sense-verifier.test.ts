import { describe, expect, test } from "vitest";

import type { WordDetail } from "../../content/word-detail";
import { TokenBudget } from "../enrichment/budget";
import { dictionarySenseId } from "../enrichment/dictionary-import";
import type { VocabularyRecord } from "../schema";
import { vocabularyRecordFixture } from "../test-fixtures";
import type { FactualDictionaryEvidence, SourcedExampleEvidence } from "./provider-types";
import {
  eligibleFactualSenses,
  verifyCandidateSense,
  type SenseJudge,
  type SenseVerificationInput,
} from "./sense-verifier";

const source = {
  sourceId: "dictionaryapi",
  url: "https://dictionary.example/manifest",
  retrievedAt: "2026-08-24T00:00:00.000Z",
  contentHash: "sha256:manifest",
} as const;

function candidate(overrides: Partial<VocabularyRecord> = {}): VocabularyRecord {
  return {
    ...vocabularyRecordFixture(),
    lemma: "manifest",
    display: "manifest",
    partOfSpeech: "verb",
    forms: ["manifests", "manifested", "manifesting"],
    ...overrides,
  };
}

function detail(senses: WordDetail["senses"]): WordDetail {
  return {
    ipa: null,
    audioUk: null,
    audioUs: null,
    audioAny: null,
    sourceEntryId: "manifest-entry",
    sourceUrl: "https://dictionary.example/manifest",
    senses,
    synonyms: [],
  };
}

function factualEvidence(
  senses: WordDetail["senses"],
  overrides: Partial<FactualDictionaryEvidence> = {},
): FactualDictionaryEvidence {
  return {
    provider: "dictionaryapi",
    returnedLemma: "manifest",
    requestedPartOfSpeech: "verb",
    detail: detail(senses),
    source,
    ...overrides,
  };
}

function input(
  dictionaryEvidence: FactualDictionaryEvidence[],
  overrides: Partial<SenseVerificationInput> = {},
): SenseVerificationInput {
  return {
    candidate: candidate(),
    dictionaryEvidence,
    tatoebaExamples: [],
    tokenBudget: new TokenBudget({ maxInputTokens: 100, maxOutputTokens: 100 }),
    requestId: "verify:manifest",
    estimatedUsage: { inputTokens: 20, outputTokens: 20 },
    ...overrides,
  };
}

function tatoeba(id = "tatoeba:42"): SourcedExampleEvidence {
  return {
    id,
    text: "The policy manifested a clear change.",
    language: "eng",
    source: {
      sourceId: "tatoeba",
      externalId: id.slice("tatoeba:".length),
      url: `https://tatoeba.org/en/sentences/show/${id.slice("tatoeba:".length)}`,
      retrievedAt: "2026-08-24T00:00:00.000Z",
      contentHash: `sha256:${id}`,
    },
  };
}

const firstSense = {
  partOfSpeech: "verb",
  definition: "  To show something clearly.  ",
  example: "The results manifested a trend.",
  sourceSenseId: "manifest.v.01",
  sourceUrl: "https://dictionary.example/manifest#v1",
} as const;

describe("eligibleFactualSenses", () => {
  test("keeps only exact lemma, exact POS, factual-source, and usable definitions", () => {
    const record = candidate({ lemma: "café", display: "café", forms: ["cafés"] });
    const accepted = { ...firstSense, sourceSenseId: "cafe.accepted", example: "The café serves tea." };
    const result = eligibleFactualSenses(record, [
      factualEvidence([accepted], { returnedLemma: "CAFÉ", detail: detail([accepted]) }),
      factualEvidence([{ ...firstSense, sourceSenseId: "cafe.placeholder", definition: "Definition pending." }], { returnedLemma: "café" }),
      factualEvidence([{ ...firstSense, sourceSenseId: "cafe.noun", partOfSpeech: "noun" }], { returnedLemma: "café" }),
      factualEvidence([firstSense], { returnedLemma: "different" }),
      factualEvidence([{ ...firstSense, sourceSenseId: "cafe.llm" }], { returnedLemma: "café", source: { ...source, sourceId: "llm" } }),
      factualEvidence([{ ...firstSense, sourceSenseId: "cafe.unknown" }], { returnedLemma: "café", source: { ...source, sourceId: "unregistered" } }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: dictionarySenseId(record, detail([accepted]), accepted, "dictionaryapi"),
      definition: "  To show something clearly.  ",
      examples: [{ text: "The café serves tea." }],
    });
  });

  test("retains a sense but rejects substring-only dictionary examples with Unicode-aware form boundaries", () => {
    const record = candidate({ lemma: "café", display: "café", forms: ["cafés"] });
    const substringOnly = { ...firstSense, sourceSenseId: "cafe.substring", example: "The caféteria is busy." };

    const [eligible] = eligibleFactualSenses(record, [
      factualEvidence([substringOnly], { returnedLemma: "café" }),
    ]);

    expect(eligible?.examples).toEqual([]);
  });

  test("does not match a form inside a following Devanagari combining mark", () => {
    const record = candidate({ lemma: "कर", display: "कर", forms: ["क"] });
    const combiningMark = { ...firstSense, sourceSenseId: "devanagari.mark", example: "का मतलब स्पष्ट है।" };
    const standalone = { ...firstSense, sourceSenseId: "devanagari.standalone", example: "क काम शुरू है।" };

    expect(eligibleFactualSenses(record, [
      factualEvidence([combiningMark], { returnedLemma: "कर", detail: detail([combiningMark]) }),
    ])[0]?.examples).toEqual([]);
    expect(eligibleFactualSenses(record, [
      factualEvidence([standalone], { returnedLemma: "कर", detail: detail([standalone]) }),
    ])[0]?.examples).toHaveLength(1);
  });

  test("deduplicates canonical IDs without changing provider wording", () => {
    const evidence = factualEvidence([firstSense]);
    const result = eligibleFactualSenses(candidate(), [evidence, evidence]);

    expect(result).toHaveLength(1);
    expect(result[0]?.definition).toBe(firstSense.definition);
  });
});

describe("verifyCandidateSense", () => {
  test("returns no factual sense when evidence cannot pass the factual gates", async () => {
    const result = await verifyCandidateSense(input([
      factualEvidence([{ ...firstSense, definition: "Needs a fuller dictionary source." }]),
    ]), null);

    expect(result).toMatchObject({
      selectedSenseId: null,
      selectedExampleId: null,
      reason: "no_factual_sense",
      decisionSource: "deterministic",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  test("reports a POS mismatch when returned evidence has the right lemma but no exact POS", async () => {
    const result = await verifyCandidateSense(input([
      factualEvidence([{ ...firstSense, partOfSpeech: "noun" }]),
    ]), null);

    expect(result.reason).toBe("pos_mismatch");
  });

  test("selects one eligible sense with a factual matching dictionary example without calling a judge", async () => {
    const evidence = factualEvidence([firstSense]);
    const record = candidate();
    const neverCalledJudge: SenseJudge = async () => { throw new Error("judge should not run"); };

    expect(await verifyCandidateSense(input([evidence], { candidate: record }), neverCalledJudge)).toMatchObject({
      selectedSenseId: dictionarySenseId(record, evidence.detail, firstSense, "dictionaryapi"),
      reason: null,
      decisionSource: "deterministic",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  test("requires a judge to choose one of multiple supplied sense IDs and settles actual usage once", async () => {
    const secondSense = {
      ...firstSense,
      definition: "To make something happen.",
      sourceSenseId: "manifest.v.02",
      example: "The plan manifested after months of work.",
    };
    const evidence = factualEvidence([firstSense, secondSense]);
    const record = candidate();
    const selectedSenseId = dictionarySenseId(record, evidence.detail, secondSense, "dictionaryapi");
    const budget = new TokenBudget({ maxInputTokens: 100, maxOutputTokens: 100 });
    let calls = 0;
    const judge: SenseJudge = async (request) => {
      calls += 1;
      expect(request.senses.map((sense) => sense.id)).toEqual([
        dictionarySenseId(record, evidence.detail, firstSense, "dictionaryapi"),
        selectedSenseId,
      ]);
      expect(request).not.toHaveProperty("definition");
      return {
        decision: { decision: "selected", senseId: selectedSenseId, exampleId: null },
        usage: { inputTokens: 7, outputTokens: 3 },
      };
    };

    const result = await verifyCandidateSense(input([evidence], { candidate: record, tokenBudget: budget }), judge);

    expect(result).toMatchObject({ selectedSenseId, selectedExampleId: null, reason: null, decisionSource: "llm", usage: { inputTokens: 7, outputTokens: 3 } });
    expect(calls).toBe(1);
    expect(budget.remaining()).toEqual({ inputTokens: 93, outputTokens: 97 });
  });

  test("turns unknown IDs, malformed output, and explicit ambiguity into sense ambiguity", async () => {
    const secondSense = { ...firstSense, definition: "To make something happen.", sourceSenseId: "manifest.v.02" };
    const evidence = factualEvidence([firstSense, secondSense]);
    for (const decision of [
      { decision: "selected", senseId: "not-supplied", exampleId: null },
      { decision: "selected", senseId: dictionarySenseId(candidate(), evidence.detail, firstSense, "dictionaryapi"), exampleId: null, definition: "invented" },
      { decision: "ambiguous", senseId: null, exampleId: null },
    ]) {
      const result = await verifyCandidateSense(input([evidence]), async () => ({
        decision,
        usage: { inputTokens: 1, outputTokens: 1 },
      }));
      expect(result).toMatchObject({ selectedSenseId: null, selectedExampleId: null, reason: "sense_ambiguous", decisionSource: "llm" });
    }
  });

  test("rejects a dictionary example selected from a different sense", async () => {
    const secondSense = {
      ...firstSense,
      definition: "To make something happen.",
      sourceSenseId: "manifest.v.02",
      example: "The plan manifested after months of work.",
    };
    const evidence = factualEvidence([firstSense, secondSense]);
    const record = candidate();
    const firstSenseId = dictionarySenseId(record, evidence.detail, firstSense, "dictionaryapi");
    const secondSenseId = dictionarySenseId(record, evidence.detail, secondSense, "dictionaryapi");

    const result = await verifyCandidateSense(input([evidence], { candidate: record }), async () => ({
      decision: {
        decision: "selected",
        senseId: secondSenseId,
        exampleId: `dictionary:${firstSenseId}:example`,
      },
      usage: { inputTokens: 3, outputTokens: 2 },
    }));

    expect(result).toMatchObject({
      selectedSenseId: null,
      selectedExampleId: null,
      reason: "sense_ambiguous",
      decisionSource: "llm",
    });
  });

  test("attaches a Tatoeba example only when the judge returns its supplied ID for the selected sense", async () => {
    const evidence = factualEvidence([{ ...firstSense, example: null }]);
    const record = candidate();
    const selectedSenseId = dictionarySenseId(record, evidence.detail, evidence.detail.senses[0]!, "dictionaryapi");
    const example = tatoeba();

    const result = await verifyCandidateSense(input([evidence], { candidate: record, tatoebaExamples: [example] }), async (request) => {
      expect(request.examples).toEqual([{ id: example.id, text: example.text }]);
      return {
        decision: { decision: "selected", senseId: selectedSenseId, exampleId: example.id },
        usage: { inputTokens: 3, outputTokens: 2 },
      };
    });

    expect(result).toMatchObject({ selectedSenseId, selectedExampleId: example.id, reason: null, decisionSource: "llm" });
  });

  test("returns no sourced example before asking a judge when no matching factual example exists", async () => {
    const result = await verifyCandidateSense(input([
      factualEvidence([{ ...firstSense, example: "A manifestation occurred." }]),
    ]), async () => { throw new Error("judge should not run"); });

    expect(result).toMatchObject({ reason: "no_sourced_example", decisionSource: "deterministic" });
  });

  test("does not call an unavailable judge after a rejected token reservation", async () => {
    const secondSense = { ...firstSense, definition: "To make something happen.", sourceSenseId: "manifest.v.02" };
    const result = await verifyCandidateSense(input([factualEvidence([firstSense, secondSense])], {
      tokenBudget: new TokenBudget({ maxInputTokens: 1, maxOutputTokens: 1 }),
    }), async () => { throw new Error("judge should not run"); });

    expect(result).toMatchObject({ reason: "budget_exhausted", decisionSource: "unavailable", usage: { inputTokens: 0, outputTokens: 0 } });
  });

  test("reports an unavailable judge only when a finite decision is required", async () => {
    const secondSense = { ...firstSense, definition: "To make something happen.", sourceSenseId: "manifest.v.02" };
    const result = await verifyCandidateSense(input([factualEvidence([firstSense, secondSense])]), null);

    expect(result).toMatchObject({ reason: "judge_unavailable", decisionSource: "unavailable" });
  });

  test("settles the estimated usage once when a reserved judge request throws", async () => {
    const secondSense = { ...firstSense, definition: "To make something happen.", sourceSenseId: "manifest.v.02" };
    const estimatedUsage = { inputTokens: 20, outputTokens: 15 };
    const budget = new TokenBudget({ maxInputTokens: 100, maxOutputTokens: 100 });

    const result = await verifyCandidateSense(input([factualEvidence([firstSense, secondSense])], {
      tokenBudget: budget,
      estimatedUsage,
    }), async () => { throw new Error("transport failed after provider dispatch"); });

    expect(result).toMatchObject({
      reason: "judge_unavailable",
      decisionSource: "unavailable",
      usage: estimatedUsage,
    });
    expect(budget.remaining()).toEqual({ inputTokens: 80, outputTokens: 85 });
  });
});
