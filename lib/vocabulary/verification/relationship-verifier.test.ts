import { describe, expect, test } from "vitest";

import { TokenBudget, type TokenUsage } from "../enrichment/budget";
import type { VocabularyRecord } from "../schema";
import { vocabularyRecordFixture } from "../test-fixtures";
import type { FactualDictionaryEvidence } from "./provider-types";
import { eligibleFactualSenses, type EligibleFactualSense } from "./sense-verifier";
import {
  verifyCandidateRelationships,
  type RelationshipJudge,
  type RelationshipJudgeRequest,
  type RelationshipVerificationInput,
} from "./relationship-verifier";
import type { ReciprocalCoreAnchor } from "./types";

const factualSource = {
  sourceId: "wordnet",
  externalId: "wordnet:fixture",
  url: "https://wordnet.example/fixture",
  retrievedAt: "2026-08-24T00:00:00.000Z",
  contentHash: "sha256:wordnet-fixture",
} as const;

const llmSource = {
  ...factualSource,
  sourceId: "llm",
} as const;

const candidateGloss = "\tBuilds  on: examine — café!  ";
const coreGloss = "  Advanced\tform: scrutinise → naïve? ";
const candidateDefinition = "  To examine something very carefully.  ";
const estimatedUsage = { inputTokens: 10, outputTokens: 5 } as const;

function record(lemma: string, overrides: Partial<VocabularyRecord> = {}): VocabularyRecord {
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
  type: "builds_on" | "advanced_form",
  gloss: string | null,
) {
  return {
    ...vocabularyRecordFixture().connections[0]!,
    target,
    type,
    gloss,
    status: "published" as const,
  };
}

function synonymEvidence(
  synonyms: string[],
  overrides: {
    provider?: FactualDictionaryEvidence["provider"];
    sourceId?: string;
    returnedLemma?: string;
    requestedPartOfSpeech?: string;
  } = {},
): FactualDictionaryEvidence {
  const provider = overrides.provider ?? "wordnet";
  return {
    provider,
    returnedLemma: overrides.returnedLemma ?? "scrutinise",
    requestedPartOfSpeech: overrides.requestedPartOfSpeech ?? "verb",
    detail: {
      ipa: null,
      audioUk: null,
      audioUs: null,
      audioAny: null,
      sourceEntryId: "scrutinise-entry",
      sourceUrl: `https://${provider}.example/scrutinise`,
      senses: [{
        partOfSpeech: "verb",
        definition: candidateDefinition,
        example: "They scrutinise the evidence carefully.",
        sourceSenseId: "scrutinise.v.01",
        sourceUrl: `https://${provider}.example/scrutinise#verb-1`,
      }],
      synonyms,
    },
    source: {
      sourceId: overrides.sourceId ?? provider,
      url: `https://${provider}.example/scrutinise`,
      retrievedAt: "2026-08-24T00:00:00.000Z",
      contentHash: `sha256:${provider}-scrutinise`,
    },
  };
}

function canonicalSelectedSense(
  candidate: VocabularyRecord,
  evidence: readonly FactualDictionaryEvidence[],
): EligibleFactualSense {
  const selected = eligibleFactualSenses(candidate, evidence)[0];
  if (!selected) throw new Error("fixture requires an eligible candidate sense");
  return selected;
}

function fixture(overrides: Partial<RelationshipVerificationInput> = {}) {
  const defaultCandidate = record("scrutinise", {
    tier: "advanced",
    publicationStatus: "hidden",
    connections: [connection("examine", "builds_on", candidateGloss)],
  });
  const candidate = overrides.candidate ?? defaultCandidate;
  const factualDictionaryEvidence = overrides.factualDictionaryEvidence ?? [synonymEvidence([])];
  const selectedSense = overrides.selectedSense
    ?? canonicalSelectedSense(candidate, factualDictionaryEvidence);
  const core = record("examine", {
    tier: "core",
    publicationStatus: "published",
    senses: [{
      ...vocabularyRecordFixture().senses[0]!,
      id: "examine:wordnet:verb:1",
      definition: "  To look at something carefully.  ",
      sources: [factualSource],
      status: "published",
    }],
    connections: [connection("scrutinise", "advanced_form", coreGloss)],
  });
  const anchors: ReciprocalCoreAnchor[] = [{
    coreLemma: core.lemma,
    candidateType: "builds_on",
    coreType: "advanced_form",
    candidateGloss,
    coreGloss,
  }];

  return {
    candidate,
    selectedSense,
    anchors,
    factualDictionaryEvidence,
    coreRecords: [core],
    tokenBudget: new TokenBudget({ maxInputTokens: 100, maxOutputTokens: 100 }),
    requestId: "relationship:scrutinise",
    estimatedUsage,
    ...overrides,
  } satisfies RelationshipVerificationInput;
}

async function expectRejectedBeforeJudge(input: RelationshipVerificationInput) {
  let calls = 0;
  const result = await verifyCandidateRelationships(input, async (request) => {
    calls += 1;
    return response("supported", request);
  });

  expect(result.decisions[0]).toMatchObject({
    decision: "ambiguous",
    method: "unavailable",
    reason: "no_factual_sense",
  });
  expect(result.hasSupportedAnchor).toBe(false);
  expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  expect(calls).toBe(0);
}

function response(
  decision: "supported" | "unsupported" | "ambiguous",
  request: RelationshipJudgeRequest,
  usage: TokenUsage = { inputTokens: 2, outputTokens: 1 },
) {
  return {
    decision: {
      decision,
      candidateSenseId: request.candidateSenseId,
      coreLemma: request.coreLemma,
    },
    usage,
  };
}

describe("verifyCandidateRelationships", () => {
  test("supports exact normalized factual synonym evidence without a model call and preserves gloss bytes", async () => {
    const neverCalledJudge: RelationshipJudge = async () => { throw new Error("judge should not run"); };

    for (const provider of ["wordnet", "dictionaryapi"] as const) {
      const input = fixture({
        factualDictionaryEvidence: [synonymEvidence(["  EXAMINE  ", "scrutinise"], {
          provider,
          returnedLemma: "  SCRUTINISE__",
        })],
      });
      const result = await verifyCandidateRelationships(input, neverCalledJudge);

      expect(result.decisions).toHaveLength(1);
      expect(result.decisions[0]).toMatchObject({
        coreLemma: "examine",
        decision: "supported",
        method: "direct_lexical",
        reason: null,
      });
      expect(result.decisions[0]?.candidateGloss).toBe(candidateGloss);
      expect(result.decisions[0]?.coreGloss).toBe(coreGloss);
      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
      expect(result.hasSupportedAnchor).toBe(true);
    }
  });

  test("does not treat substrings, stems, or reciprocal connection type alone as direct lexical evidence", async () => {
    for (const synonyms of [["reexamine"], ["examining"], []]) {
      const factualDictionaryEvidence = [synonymEvidence(synonyms)];
      const result = await verifyCandidateRelationships(fixture({ factualDictionaryEvidence }), null);

      expect(result.decisions[0]).toMatchObject({
        decision: "ambiguous",
        method: "unavailable",
        reason: "judge_unavailable",
      });
    }
  });

  test("rejects mismatched, LLM, unknown, and non-source-bearing synonym provenance", async () => {
    const typedInput = fixture();
    if (false) {
      // @ts-expect-error Relationship verification requires source-bearing dictionary evidence.
      typedInput.factualDictionaryEvidence = ["examine"];
    }

    const invalidEvidence = [
      synonymEvidence(["examine"], { provider: "wordnet", sourceId: "dictionaryapi" }),
      synonymEvidence(["examine"], { provider: "dictionaryapi", sourceId: "llm" }),
      synonymEvidence(["examine"], { provider: "wordnet", sourceId: "unknown-provider" }),
      "examine" as unknown as FactualDictionaryEvidence,
    ];

    for (const evidence of invalidEvidence) {
      const input = fixture();
      input.factualDictionaryEvidence = [evidence];
      const result = await verifyCandidateRelationships(input, null);

      expect(result.decisions[0]).toMatchObject({
        decision: "ambiguous",
        method: "unavailable",
        reason: "no_factual_sense",
      });
    }
  });

  test("rejects synonym evidence returned for an unrelated candidate lemma before direct support or judging", async () => {
    const input = fixture();
    input.factualDictionaryEvidence = [synonymEvidence(["examine"], { returnedLemma: "different-word" })];

    await expectRejectedBeforeJudge(input);
  });

  test("rejects synonym evidence requested for a non-exact candidate part of speech", async () => {
    const input = fixture();
    input.factualDictionaryEvidence = [synonymEvidence(["examine"], { requestedPartOfSpeech: "Verb" })];

    await expectRejectedBeforeJudge(input);
  });

  test("rejects minimally shaped evidence casts before direct support or judging", async () => {
    const input = fixture();
    input.factualDictionaryEvidence = [{
      provider: "wordnet",
      returnedLemma: "scrutinise",
      requestedPartOfSpeech: "verb",
      detail: { synonyms: ["examine"] },
      source: { sourceId: "wordnet" },
    } as unknown as FactualDictionaryEvidence];

    await expectRejectedBeforeJudge(input);
  });

  test("requires selected sense identity, POS, wording, and source metadata to match eligible candidate evidence", async () => {
    const trustedEvidence = synonymEvidence(["examine"]);
    const canonical = fixture({ factualDictionaryEvidence: [trustedEvidence] }).selectedSense;
    const mismatches: EligibleFactualSense[] = [
      { ...canonical, id: "fabricated-sense-id" },
      { ...canonical, partOfSpeech: "noun" },
      { ...canonical, definition: "Foreign wording not present in the provider evidence." },
      { ...canonical, source: { ...canonical.source, url: "https://wordnet.example/foreign-sense" } },
    ];

    for (const selectedSense of mismatches) {
      await expectRejectedBeforeJudge(fixture({
        factualDictionaryEvidence: [trustedEvidence],
        selectedSense,
      }));
    }
  });

  test("rejects a Tatoeba-backed selected sense before direct support or judging", async () => {
    const trustedEvidence = synonymEvidence(["examine"]);
    const canonical = fixture({ factualDictionaryEvidence: [trustedEvidence] }).selectedSense;

    await expectRejectedBeforeJudge(fixture({
      factualDictionaryEvidence: [trustedEvidence],
      selectedSense: {
        ...canonical,
        source: { ...canonical.source, sourceId: "tatoeba" },
      },
    }));
  });

  test("does not accept an LLM-only core sense as direct lexical support", async () => {
    const input = fixture({ factualDictionaryEvidence: [synonymEvidence(["examine"])] });
    const core = input.coreRecords[0]!;
    input.coreRecords = [{
      ...core,
      senses: [{ ...core.senses[0]!, sources: [llmSource] }],
    }];
    let calls = 0;

    const result = await verifyCandidateRelationships(input, async () => {
      calls += 1;
      throw new Error("judge should not run");
    });

    expect(result.decisions[0]).toMatchObject({
      decision: "ambiguous",
      method: "unavailable",
      reason: "no_factual_sense",
    });
    expect(calls).toBe(0);
  });

  test("rejects Tatoeba-only and unknown-source core definitions before judging", async () => {
    for (const sourceId of ["tatoeba", "unknown-provider"]) {
      const input = fixture();
      const core = input.coreRecords[0]!;
      input.coreRecords = [{
        ...core,
        senses: [{
          ...core.senses[0]!,
          sources: [{ ...factualSource, sourceId }],
        }],
      }];

      await expectRejectedBeforeJudge(input);
    }
  });

  test("allows curated, WordNet, and DictionaryAPI core definition sources", async () => {
    for (const sourceId of ["curated", "wordnet", "dictionaryapi"] as const) {
      const input = fixture();
      const core = input.coreRecords[0]!;
      input.coreRecords = [{
        ...core,
        senses: [{
          ...core.senses[0]!,
          sources: [{ ...factualSource, sourceId }],
        }],
      }];

      const result = await verifyCandidateRelationships(input, async (request) => response("supported", request));

      expect(result.decisions[0]).toMatchObject({
        decision: "supported",
        method: "llm_consensus",
        reason: null,
      });
    }
  });

  test("requires two order-reversed supported decisions over the same finite evidence", async () => {
    const requests: RelationshipJudgeRequest[] = [];
    const result = await verifyCandidateRelationships(fixture(), async (request) => {
      requests.push(request);
      return response("supported", request);
    });

    expect(result.decisions[0]).toMatchObject({ decision: "supported", method: "llm_consensus", reason: null });
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.senses.map((sense) => sense.role))).toEqual([
      ["candidate", "core"],
      ["core", "candidate"],
    ]);
    expect(requests[0]?.senses).toEqual([...requests[1]!.senses].reverse());
    expect(requests[0]?.relationship).toEqual(requests[1]?.relationship);
    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 2 });
  });

  test("returns unsupported only when both order-reversed decisions are unsupported", async () => {
    const result = await verifyCandidateRelationships(fixture(), async (request) => response("unsupported", request));

    expect(result.decisions[0]).toMatchObject({
      decision: "unsupported",
      method: "llm_consensus",
      reason: "relationship_unsupported",
    });
    expect(result.hasSupportedAnchor).toBe(false);
  });

  test("treats disagreement and explicit ambiguity as ambiguous", async () => {
    for (const decisions of [["supported", "unsupported"], ["ambiguous", "ambiguous"]] as const) {
      let index = 0;
      const result = await verifyCandidateRelationships(fixture(), async (request) => response(decisions[index++]!, request));

      expect(result.decisions[0]).toMatchObject({
        decision: "ambiguous",
        method: "llm_disagreement",
        reason: "relationship_ambiguous",
      });
    }
  });

  test("treats malformed responses and wrong echoed identifiers as ambiguous", async () => {
    const invalidResponses: unknown[] = [
      { decision: "supported", candidateSenseId: "scrutinise:wordnet:verb:1" },
      { decision: "supported", candidateSenseId: "wrong-sense", coreLemma: "examine" },
      { decision: "supported", candidateSenseId: "scrutinise:wordnet:verb:1", coreLemma: "wrong-core" },
    ];

    for (const invalidDecision of invalidResponses) {
      let calls = 0;
      const result = await verifyCandidateRelationships(fixture(), async (request) => {
        calls += 1;
        return calls === 1
          ? { decision: invalidDecision, usage: { inputTokens: 2, outputTokens: 1 } }
          : response("supported", request);
      });

      expect(result.decisions[0]).toMatchObject({
        decision: "ambiguous",
        method: "llm_disagreement",
        reason: "relationship_ambiguous",
      });
      expect(calls).toBe(2);
    }
  });

  test("requires a published factual core sense before making a model call", async () => {
    const input = fixture();
    const core = input.coreRecords[0]!;
    input.coreRecords = [{
      ...core,
      senses: [{ ...core.senses[0]!, status: "review" }],
    }];
    let calls = 0;

    const result = await verifyCandidateRelationships(input, async () => {
      calls += 1;
      throw new Error("judge should not run");
    });

    expect(result.decisions[0]).toMatchObject({
      decision: "ambiguous",
      method: "unavailable",
      reason: "no_factual_sense",
    });
    expect(calls).toBe(0);
  });

  test("does not call a judge when two conservative reservations cannot fit", async () => {
    let calls = 0;
    const result = await verifyCandidateRelationships(fixture({
      tokenBudget: new TokenBudget({ maxInputTokens: 19, maxOutputTokens: 10 }),
    }), async () => {
      calls += 1;
      throw new Error("judge should not run");
    });

    expect(result.decisions[0]).toMatchObject({
      decision: "ambiguous",
      method: "unavailable",
      reason: "budget_exhausted",
    });
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(calls).toBe(0);
  });

  test("reports an unavailable judge only after deterministic evidence gates pass", async () => {
    const result = await verifyCandidateRelationships(fixture(), null);

    expect(result.decisions[0]).toMatchObject({
      decision: "ambiguous",
      method: "unavailable",
      reason: "judge_unavailable",
    });
  });

  test("settles both conservative reservations when the first judge call throws", async () => {
    const tokenBudget = new TokenBudget({ maxInputTokens: 100, maxOutputTokens: 100 });
    let calls = 0;

    const result = await verifyCandidateRelationships(fixture({ tokenBudget }), async () => {
      calls += 1;
      throw new Error("first judge call failed after dispatch");
    });

    expect(result.decisions[0]).toMatchObject({
      decision: "ambiguous",
      method: "unavailable",
      reason: "judge_unavailable",
    });
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    expect(tokenBudget.remaining()).toEqual({ inputTokens: 80, outputTokens: 90 });
    expect(calls).toBe(1);
  });

  test("settles actual first-call usage and conservative second-call usage when the second call throws", async () => {
    const tokenBudget = new TokenBudget({ maxInputTokens: 100, maxOutputTokens: 100 });
    let calls = 0;

    const result = await verifyCandidateRelationships(fixture({ tokenBudget }), async (request) => {
      calls += 1;
      if (calls === 1) return response("supported", request, { inputTokens: 2, outputTokens: 1 });
      throw new Error("second judge call failed after dispatch");
    });

    expect(result.decisions[0]).toMatchObject({
      decision: "ambiguous",
      method: "unavailable",
      reason: "judge_unavailable",
    });
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 6 });
    expect(tokenBudget.remaining()).toEqual({ inputTokens: 88, outputTokens: 94 });
    expect(calls).toBe(2);
  });

  test("rejects missing reciprocal edges and missing reciprocal glosses without creating targets", async () => {
    const missingReverse = fixture();
    missingReverse.coreRecords = [{ ...missingReverse.coreRecords[0]!, connections: [] }];
    const missingGloss = fixture();
    missingGloss.candidate = {
      ...missingGloss.candidate,
      connections: [connection("examine", "builds_on", null)],
    };

    for (const input of [missingReverse, missingGloss]) {
      const result = await verifyCandidateRelationships(input, async () => { throw new Error("judge should not run"); });

      expect(result.decisions[0]).toMatchObject({
        decision: "ambiguous",
        method: "unavailable",
        reason: "no_reciprocal_anchor",
      });
      expect(result.hasSupportedAnchor).toBe(false);
    }
  });
});
