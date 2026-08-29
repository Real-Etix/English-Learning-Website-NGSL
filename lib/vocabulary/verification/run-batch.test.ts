import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";
import type { z } from "zod";

import type { WordDetail } from "../../content/word-detail";
import { auditDictionaryRecords } from "../../wiki/dictionary-quality";
import type { TokenUsage } from "../enrichment/budget";
import type { VocabularyRecord } from "../schema";
import { vocabularyRecordFixture } from "../test-fixtures";
import type { VerificationCache } from "./cache";
import type { FactualDictionaryEvidence, SourcedExampleEvidence } from "./provider-types";
import {
  runVerificationBatch,
  type VerificationDependencies,
  type VerificationRunOptions,
} from "./run-batch";

class MemoryCache implements VerificationCache {
  readonly values = new Map<string, unknown>();

  async get<T>(namespace: string, key: string, schema: z.ZodType<T>): Promise<T | null> {
    const value = this.values.get(`${namespace}:${key}`);
    if (value === undefined) return null;
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  async set<T>(namespace: string, key: string, value: T, schema: z.ZodType<T>): Promise<void> {
    this.values.set(`${namespace}:${key}`, schema.parse(value));
  }
}

function sourceRef(sourceId: "llm" | "wordnet" | "tatoeba", suffix: string) {
  return {
    sourceId,
    externalId: suffix,
    url: sourceId === "llm" ? null : `https://${sourceId}.example/${suffix}`,
    retrievedAt: "2026-08-24T00:00:00.000Z",
    contentHash: `sha256:${sourceId}-${suffix}`,
  };
}

function coreRecord(lemma: string, advancedLemma: string): VocabularyRecord {
  const fixture = vocabularyRecordFixture();
  return {
    ...fixture,
    lemma,
    display: lemma,
    tier: "core",
    publicationStatus: "published",
    senses: [{
      ...fixture.senses[0]!,
      id: `${lemma}-sense`,
      partOfSpeech: "verb",
      definition: `To use the core word ${lemma}.`,
      sources: [sourceRef("wordnet", `${lemma}-sense`)],
      examples: [{
        text: `They ${lemma} the result.`,
        sources: [sourceRef("wordnet", `${lemma}-example`)],
      }],
      status: "published",
    }],
    connections: [{
      target: advancedLemma,
      type: "advanced_form",
      gloss: `  ${advancedLemma} is an advanced form of ${lemma}.  `,
      sources: [sourceRef("llm", `${lemma}-${advancedLemma}`)],
      status: "published",
    }],
  };
}

function advancedRecord(lemma: string, coreLemma: string): VocabularyRecord {
  const fixture = vocabularyRecordFixture();
  return {
    ...fixture,
    lemma,
    display: lemma,
    tier: "advanced",
    partOfSpeech: "verb",
    forms: [`${lemma}s`, `${lemma}d`, `${lemma}ing`],
    status: "seeded",
    publicationStatus: "hidden",
    sources: [sourceRef("llm", lemma)],
    senses: [{
      ...fixture.senses[0]!,
      id: `${lemma}-legacy-llm`,
      partOfSpeech: "verb",
      definition: `A draft definition for ${lemma}.`,
      sources: [sourceRef("llm", `${lemma}-sense`)],
      examples: [],
      status: "published",
    }],
    pronunciation: [],
    connections: [{
      target: coreLemma,
      type: "builds_on",
      gloss: `\t${lemma} builds  on ${coreLemma}.  `,
      sources: [sourceRef("llm", `${lemma}-${coreLemma}`)],
      status: "published",
    }],
  };
}

function recordsFor(lemmas: string[]): VocabularyRecord[] {
  return lemmas.flatMap((lemma) => {
    const coreLemma = `core-${lemma}`;
    return [coreRecord(coreLemma, lemma), advancedRecord(lemma, coreLemma)];
  });
}

function wordDetail(lemma: string, coreLemma: string, dictionaryExample: boolean): WordDetail {
  return {
    ipa: null,
    audioUk: null,
    audioUs: null,
    audioAny: null,
    sourceEntryId: `${lemma}-entry`,
    senses: [{
      partOfSpeech: "verb",
      definition: `To ${lemma} something with careful attention.`,
      example: dictionaryExample ? `They ${lemma} the result carefully.` : null,
      sourceSenseId: `${lemma}.v.01`,
    }],
    synonyms: [coreLemma],
  };
}

function evidenceFor(
  lemma: string,
  coreLemma = `core-${lemma}`,
  dictionaryExample = true,
): FactualDictionaryEvidence {
  const detail = wordDetail(lemma, coreLemma, dictionaryExample);
  const hash = createHash("sha256").update(JSON.stringify(detail), "utf8").digest("hex");
  return {
    provider: "wordnet",
    returnedLemma: lemma,
    requestedPartOfSpeech: "verb",
    detail,
    source: {
      sourceId: "wordnet",
      url: null,
      retrievedAt: "2026-08-24T00:00:00.000Z",
      contentHash: `sha256:${hash}`,
    },
  };
}

function tatoebaFor(lemma: string): SourcedExampleEvidence[] {
  return [{
    id: `tatoeba:${lemma}`,
    text: `They ${lemma} the result before deciding.`,
    language: "eng",
    source: {
      sourceId: "tatoeba",
      externalId: lemma,
      url: `https://tatoeba.org/en/sentences/show/${lemma}`,
      retrievedAt: "2026-08-24T00:00:00.000Z",
      contentHash: `sha256:tatoeba-${lemma}`,
    },
  }];
}

const defaultOptions: VerificationRunOptions = {
  limit: 25,
  concurrency: 1,
  maxSourceRequests: 100,
  maxInputTokens: 1_000,
  maxOutputTokens: 1_000,
  write: false,
};

function dependencies(
  records: VocabularyRecord[],
  overrides: Partial<VerificationDependencies> = {},
): VerificationDependencies {
  return {
    loadRecords: async () => records,
    cache: new MemoryCache(),
    getWordNet: async (candidate) => evidenceFor(candidate.record.lemma, candidate.anchors[0]?.coreLemma),
    getDictionary: async () => null,
    getTatoeba: async () => [],
    judgeSense: null,
    judgeRelationship: null,
    estimatedSenseUsage: { inputTokens: 20, outputTokens: 10 },
    estimatedRelationshipUsage: { inputTokens: 20, outputTokens: 10 },
    modelId: "fixture-model",
    persist: async () => [],
    buildGraphs: async () => undefined,
    ...overrides,
  };
}

describe("runVerificationBatch", () => {
  test("selects deterministically, uses a bounded worker pool, and restores candidate order", async () => {
    const records = recordsFor(["zeta", "alpha", "beta"]);
    let active = 0;
    let maxActive = 0;
    const deps = dependencies(records, {
      getWordNet: async (candidate) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, candidate.record.lemma === "alpha" ? 12 : 2));
        active -= 1;
        return evidenceFor(candidate.record.lemma, candidate.anchors[0]!.coreLemma);
      },
    });

    const result = await runVerificationBatch({ ...defaultOptions, concurrency: 2 }, deps);

    expect(maxActive).toBe(2);
    expect(result.outcomes.map((outcome) => outcome.candidateLemma)).toEqual(["alpha", "beta", "zeta"]);
    expect(result.report.entries.map((entry) => entry.lemma)).toEqual(["alpha", "beta", "zeta"]);
    expect(result.report).toMatchObject({ selected: 3, attempted: 3, published: 3 });
  });

  test("uses normalized source/model cache hits without provider calls or token cost", async () => {
    const records = recordsFor(["scrutinise"]);
    const cache = new MemoryCache();
    let providerCalls = 0;
    let judgeCalls = 0;
    const makeDependencies = () => dependencies(records, {
      cache,
      getWordNet: async (candidate) => {
        providerCalls += 1;
        return evidenceFor(candidate.record.lemma, candidate.anchors[0]!.coreLemma, false);
      },
      getDictionary: async () => {
        providerCalls += 1;
        return null;
      },
      getTatoeba: async (candidate) => {
        providerCalls += 1;
        return tatoebaFor(candidate.record.lemma);
      },
      judgeSense: async (request) => {
        judgeCalls += 1;
        return {
          decision: {
            decision: "selected",
            senseId: request.senses[0]!.id,
            exampleId: request.examples.find((example) => example.id.startsWith("tatoeba:"))!.id,
          },
          usage: { inputTokens: 7, outputTokens: 3 },
        };
      },
    });

    const first = await runVerificationBatch(defaultOptions, makeDependencies());
    expect(providerCalls).toBe(3);
    expect(judgeCalls).toBe(1);
    expect(first.report.tokenUsage).toEqual({ inputTokens: 7, outputTokens: 3 });

    providerCalls = 0;
    judgeCalls = 0;
    const repeated = await runVerificationBatch(defaultOptions, makeDependencies());

    expect(providerCalls).toBe(0);
    expect(judgeCalls).toBe(0);
    expect(repeated.report.requests).toEqual({ source: 0, llm: 0 });
    expect(repeated.report.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(repeated.report.cache).toMatchObject({
      wordnet: { hits: 1, misses: 0 },
      dictionaryapi: { hits: 1, misses: 0 },
      tatoeba: { hits: 1, misses: 0 },
      llm: { hits: 1, misses: 0 },
    });
    expect(repeated.mutation.snapshot).toEqual(first.mutation.snapshot);
  });

  test("replays the pinned candidate batch after a write instead of advancing to new words", async () => {
    let storedRecords = recordsFor(["alpha", "beta"]);
    const cache = new MemoryCache();
    let persistCalls = 0;
    let buildCalls = 0;
    const deps = () => dependencies(storedRecords, {
      cache,
      persist: async (updates) => {
        persistCalls += 1;
        const byLemma = new Map(storedRecords.map((record) => [record.lemma, record]));
        for (const update of updates) byLemma.set(update.lemma, update);
        storedRecords = [...byLemma.values()];
        return ["01"];
      },
      buildGraphs: async () => { buildCalls += 1; },
    });

    const first = await runVerificationBatch({
      ...defaultOptions,
      limit: 1,
      write: true,
    }, deps());
    expect(first.report.entries.map((entry) => entry.lemma)).toEqual(["alpha"]);

    persistCalls = 0;
    buildCalls = 0;
    const repeated = await runVerificationBatch({
      ...defaultOptions,
      limit: 1,
      write: true,
      batch: first.batch,
    }, deps());

    expect(repeated.report.entries.map((entry) => entry.lemma)).toEqual(["alpha"]);
    expect(repeated.mutation.updates).toEqual([]);
    expect(persistCalls).toBe(0);
    expect(buildCalls).toBe(0);
  });

  test("rejects replay when recomputed outcomes differ from the pinned dry-run", async () => {
    const records = recordsFor(["alpha"]);
    const first = await runVerificationBatch({ ...defaultOptions, limit: 1 }, dependencies(records));
    let persistCalls = 0;
    let buildCalls = 0;

    await expect(runVerificationBatch({
      ...defaultOptions,
      limit: 1,
      write: true,
      batch: first.batch,
    }, dependencies(records, {
      cache: new MemoryCache(),
      getWordNet: async (candidate) => evidenceFor(candidate.record.lemma, "unrelated-core"),
      judgeRelationship: async (request) => ({
        decision: {
          decision: "unsupported",
          candidateSenseId: request.candidateSenseId,
          coreLemma: request.coreLemma,
        },
        usage: { inputTokens: 5, outputTokens: 2 },
      }),
      persist: async () => { persistCalls += 1; return ["01"]; },
      buildGraphs: async () => { buildCalls += 1; },
    }))).rejects.toThrow(/pinned batch outcome changed/i);

    expect(persistCalls).toBe(0);
    expect(buildCalls).toBe(0);
  });

  test("retries a pending graph build after canonical persistence already succeeded", async () => {
    let storedRecords = recordsFor(["alpha"]);
    const cache = new MemoryCache();
    const dryRun = await runVerificationBatch(
      { ...defaultOptions, limit: 1 },
      dependencies(storedRecords, { cache }),
    );
    let persistCalls = 0;
    let buildCalls = 0;
    const deps = () => dependencies(storedRecords, {
      cache,
      persist: async (updates) => {
        persistCalls += 1;
        const byLemma = new Map(storedRecords.map((record) => [record.lemma, record]));
        for (const update of updates) byLemma.set(update.lemma, update);
        storedRecords = [...byLemma.values()];
        return ["01"];
      },
      buildGraphs: async () => {
        buildCalls += 1;
        if (buildCalls === 1) throw new Error("graph build failed");
      },
    });

    await expect(runVerificationBatch({
      ...defaultOptions,
      limit: 1,
      write: true,
      batch: dryRun.batch,
    }, deps())).rejects.toThrow("graph build failed");
    expect(persistCalls).toBe(1);

    const recovered = await runVerificationBatch({
      ...defaultOptions,
      limit: 1,
      write: true,
      batch: dryRun.batch,
      rebuildGraphs: true,
    }, deps());

    expect(recovered.report.changedShards).toEqual([]);
    expect(persistCalls).toBe(1);
    expect(buildCalls).toBe(2);
  });

  test("rejects a pinned batch after a later manual relationship decision", async () => {
    let storedRecords = recordsFor(["alpha", "beta"]);
    const cache = new MemoryCache();
    let persistCalls = 0;
    let providerCalls = 0;
    const deps = () => dependencies(storedRecords, {
      cache,
      getWordNet: async (candidate) => {
        providerCalls += 1;
        return evidenceFor(candidate.record.lemma, candidate.anchors[0]!.coreLemma);
      },
      persist: async (updates) => {
        persistCalls += 1;
        const byLemma = new Map(storedRecords.map((record) => [record.lemma, record]));
        for (const update of updates) byLemma.set(update.lemma, update);
        storedRecords = [...byLemma.values()];
        return ["01"];
      },
    });

    const first = await runVerificationBatch({
      ...defaultOptions,
      limit: 1,
      write: true,
    }, deps());
    storedRecords = storedRecords.map((record) => {
      if (record.lemma !== "alpha" && record.lemma !== "core-alpha") return record;
      return {
        ...record,
        connections: record.connections.map((connection) =>
          connection.target === (record.lemma === "alpha" ? "core-alpha" : "alpha")
            ? { ...connection, status: "unreviewed" as const }
            : connection),
      };
    });
    persistCalls = 0;
    providerCalls = 0;

    await expect(runVerificationBatch({
      ...defaultOptions,
      limit: 1,
      write: true,
      batch: first.batch,
    }, deps())).rejects.toThrow(/stale/i);

    expect(providerCalls).toBe(0);
    expect(persistCalls).toBe(0);
  });

  test("processes a fully cached batch with zero source and token ceilings", async () => {
    const records = recordsFor(["alpha", "beta"]);
    const cache = new MemoryCache();
    let providerCalls = 0;
    const deps = () => dependencies(records, {
      cache,
      getWordNet: async (candidate) => {
        providerCalls += 1;
        return evidenceFor(candidate.record.lemma, candidate.anchors[0]!.coreLemma);
      },
      getDictionary: async () => { providerCalls += 1; return null; },
      getTatoeba: async () => { providerCalls += 1; return []; },
    });

    await runVerificationBatch({ ...defaultOptions, limit: 2 }, deps());
    providerCalls = 0;
    const cached = await runVerificationBatch({
      ...defaultOptions,
      limit: 2,
      maxSourceRequests: 0,
      maxInputTokens: 0,
      maxOutputTokens: 0,
    }, deps());

    expect(providerCalls).toBe(0);
    expect(cached.report).toMatchObject({ selected: 2, attempted: 2, published: 2 });
  });

  test("processes every deterministic direct candidate when the LLM budget is disabled", async () => {
    const result = await runVerificationBatch({
      ...defaultOptions,
      limit: 2,
      maxInputTokens: 0,
      maxOutputTokens: 0,
    }, dependencies(recordsFor(["alpha", "beta"])));

    expect(result.report).toMatchObject({ selected: 2, attempted: 2, published: 2 });
    expect(result.report.requests.llm).toBe(0);
  });

  test("stops before the next external source call when its source budget is exhausted", async () => {
    const records = recordsFor(["alpha", "beta"]);
    let dictionaryCalls = 0;
    let tatoebaCalls = 0;
    const result = await runVerificationBatch({
      ...defaultOptions,
      limit: 2,
      maxSourceRequests: 1,
    }, dependencies(records, {
      getDictionary: async () => {
        dictionaryCalls += 1;
        return null;
      },
      getTatoeba: async () => {
        tatoebaCalls += 1;
        return [];
      },
    }));

    expect(dictionaryCalls).toBe(1);
    expect(tatoebaCalls).toBe(0);
    expect(result.report).toMatchObject({ selected: 2, attempted: 1 });
    expect(result.outcomes[0]?.reason).toBe("budget_exhausted");
  });

  test("stops before a required model call when the token reservation cannot fit", async () => {
    const records = recordsFor(["alpha", "beta"]);
    let judgeCalls = 0;
    const result = await runVerificationBatch({
      ...defaultOptions,
      limit: 2,
      maxInputTokens: 19,
      maxOutputTokens: 9,
    }, dependencies(records, {
      getWordNet: async (candidate) => evidenceFor(candidate.record.lemma, candidate.anchors[0]!.coreLemma, false),
      getTatoeba: async (candidate) => tatoebaFor(candidate.record.lemma),
      judgeSense: async () => {
        judgeCalls += 1;
        throw new Error("must not dispatch");
      },
    }));

    expect(judgeCalls).toBe(0);
    expect(result.report).toMatchObject({ selected: 2, attempted: 1 });
    expect(result.outcomes[0]?.reason).toBe("budget_exhausted");
  });

  test("fails a provider error closed and emits complete ambiguous relationship decisions", async () => {
    const records = recordsFor(["scrutinise"]);
    const result = await runVerificationBatch(defaultOptions, dependencies(records, {
      getDictionary: async () => { throw new Error("provider offline"); },
    }));

    expect(result.outcomes[0]).toMatchObject({
      candidateLemma: "scrutinise",
      reason: "provider_failed",
      relationships: [{ decision: "ambiguous", reason: "provider_failed" }],
    });
    const candidate = result.mutation.snapshot.find((record) => record.lemma === "scrutinise")!;
    const core = result.mutation.snapshot.find((record) => record.lemma === "core-scrutinise")!;
    expect(candidate.publicationStatus).toBe("hidden");
    expect(candidate.connections[0]?.status).toBe("unreviewed");
    expect(core.connections[0]?.status).toBe("unreviewed");
  });

  test("keeps a provider failure local and continues with later candidates", async () => {
    const records = recordsFor(["alpha", "beta"]);
    const result = await runVerificationBatch({ ...defaultOptions, limit: 2 }, dependencies(records, {
      getDictionary: async (candidate) => {
        if (candidate.record.lemma === "alpha") throw new Error("alpha provider offline");
        return null;
      },
    }));

    expect(result.outcomes.map(({ candidateLemma, reason }) => ({ candidateLemma, reason }))).toEqual([
      { candidateLemma: "alpha", reason: "provider_failed" },
      { candidateLemma: "beta", reason: "published" },
    ]);
  });

  test("publishes direct lexical evidence without an LLM and fails judge-required work without one", async () => {
    const directRecords = recordsFor(["direct"]);
    const direct = await runVerificationBatch(defaultOptions, dependencies(directRecords, {
      judgeSense: async () => { throw new Error("sense judge must not run"); },
      judgeRelationship: async () => { throw new Error("relationship judge must not run"); },
    }));
    expect(direct.outcomes[0]?.reason).toBe("published");
    expect(direct.report.requests.llm).toBe(0);

    const judgedRecords = recordsFor(["judged"]);
    const unavailable = await runVerificationBatch(defaultOptions, dependencies(judgedRecords, {
      getWordNet: async (candidate) => evidenceFor(candidate.record.lemma, candidate.anchors[0]!.coreLemma, false),
      getTatoeba: async (candidate) => tatoebaFor(candidate.record.lemma),
    }));
    expect(unavailable.outcomes[0]?.reason).toBe("judge_unavailable");
  });

  test("keeps dry-run side-effect free and skips write/build when there are no updates", async () => {
    const records = recordsFor(["alpha"]);
    let persistCalls = 0;
    let buildCalls = 0;
    const deps = dependencies(records, {
      persist: async () => { persistCalls += 1; return ["01"]; },
      buildGraphs: async () => { buildCalls += 1; },
    });

    await runVerificationBatch(defaultOptions, deps);
    await runVerificationBatch({ ...defaultOptions, write: true, limit: 0 }, deps);

    expect(persistCalls).toBe(0);
    expect(buildCalls).toBe(0);
  });

  test("persists once after every outcome, then builds once and sorts changed shards", async () => {
    const records = recordsFor(["beta", "alpha"]);
    let completed = 0;
    const events: string[] = [];
    let persisted: VocabularyRecord[] = [];
    const result = await runVerificationBatch({ ...defaultOptions, write: true, concurrency: 2 }, dependencies(records, {
      getWordNet: async (candidate) => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        completed += 1;
        return evidenceFor(candidate.record.lemma, candidate.anchors[0]!.coreLemma);
      },
      persist: async (updates) => {
        expect(completed).toBe(2);
        events.push("persist");
        persisted = updates;
        return ["0f", "01"];
      },
      buildGraphs: async () => { events.push("build"); },
    }));

    expect(events).toEqual(["persist", "build"]);
    expect(persisted.length).toBeGreaterThan(0);
    expect(result.report.changedShards).toEqual(["01", "0f"]);
  });

  test("never builds after persistence failure and propagates graph failure after a write", async () => {
    const records = recordsFor(["alpha"]);
    let buildCalls = 0;
    await expect(runVerificationBatch({ ...defaultOptions, write: true }, dependencies(records, {
      persist: async () => { throw new Error("persist failed"); },
      buildGraphs: async () => { buildCalls += 1; },
    }))).rejects.toThrow("persist failed");
    expect(buildCalls).toBe(0);

    let persistCalls = 0;
    await expect(runVerificationBatch({ ...defaultOptions, write: true }, dependencies(records, {
      persist: async () => { persistCalls += 1; return ["01"]; },
      buildGraphs: async () => { throw new Error("graph failed"); },
    }))).rejects.toThrow("graph failed");
    expect(persistCalls).toBe(1);
  });

  test("validates changed shard identifiers before building generated graphs", async () => {
    let buildCalls = 0;
    await expect(runVerificationBatch({
      ...defaultOptions,
      write: true,
    }, dependencies(recordsFor(["alpha"]), {
      persist: async () => ["not-a-shard"],
      buildGraphs: async () => { buildCalls += 1; },
    }))).rejects.toThrow(/changedShards|invalid/i);

    expect(buildCalls).toBe(0);
  });

  test("finishes graph generation before surfacing cancellation during persistence", async () => {
    const controller = new AbortController();
    let buildCalls = 0;

    await expect(runVerificationBatch({
      ...defaultOptions,
      write: true,
      signal: controller.signal,
    }, dependencies(recordsFor(["alpha"]), {
      persist: async () => {
        controller.abort();
        return ["01"];
      },
      buildGraphs: async () => { buildCalls += 1; },
    }))).rejects.toMatchObject({ name: "AbortError" });

    expect(buildCalls).toBe(1);
  });

  test("never persists when the run is aborted while a candidate is being judged", async () => {
    const controller = new AbortController();
    let persistCalls = 0;
    const records = recordsFor(["alpha"]);

    await expect(runVerificationBatch({
      ...defaultOptions,
      write: true,
      signal: controller.signal,
    }, dependencies(records, {
      getWordNet: async (candidate) => evidenceFor(
        candidate.record.lemma,
        candidate.anchors[0]!.coreLemma,
        false,
      ),
      getTatoeba: async (candidate) => tatoebaFor(candidate.record.lemma),
      judgeSense: async (request) => {
        controller.abort();
        return {
          decision: {
            decision: "selected",
            senseId: request.senses[0]!.id,
            exampleId: request.examples[0]!.id,
          },
          usage: { inputTokens: 7, outputTokens: 3 },
        };
      },
      persist: async () => { persistCalls += 1; return ["01"]; },
    }))).rejects.toMatchObject({ name: "AbortError" });

    expect(persistCalls).toBe(0);
  });

  test("waits for already-started workers before propagating a worker failure", async () => {
    const controller = new AbortController();
    let started = 0;
    let releaseSibling!: () => void;
    let releaseBothStarted!: () => void;
    let siblingFinished = false;
    let settled = false;
    const siblingGate = new Promise<void>((resolve) => { releaseSibling = resolve; });
    const bothStarted = new Promise<void>((resolve) => { releaseBothStarted = resolve; });

    const run = runVerificationBatch({
      ...defaultOptions,
      concurrency: 2,
      signal: controller.signal,
    }, dependencies(recordsFor(["alpha", "beta"]), {
      getWordNet: async (candidate) => {
        started += 1;
        if (started === 2) releaseBothStarted();
        await bothStarted;
        if (candidate.record.lemma === "alpha") {
          controller.abort();
          const error = new Error("abort alpha");
          error.name = "AbortError";
          throw error;
        }
        await siblingGate;
        siblingFinished = true;
        return evidenceFor(candidate.record.lemma, candidate.anchors[0]!.coreLemma);
      },
    })).then(
      () => ({ error: null }),
      (error: unknown) => ({ error }),
    ).finally(() => { settled = true; });

    await bothStarted;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const settledBeforeSibling = settled;
    releaseSibling();
    const result = await run;

    expect(settledBeforeSibling).toBe(false);
    expect(siblingFinished).toBe(true);
    expect(result.error).toMatchObject({ name: "AbortError" });
  });

  test("rejects newly introduced lint identities before persistence", async () => {
    const records = recordsFor(["alpha"]);
    let lintCalls = 0;
    let persistCalls = 0;
    await expect(runVerificationBatch({ ...defaultOptions, write: true }, dependencies(records, {
      lintRecords: () => {
        lintCalls += 1;
        return lintCalls === 1 ? [] : [{ level: "error", lemma: "alpha", message: "new identity" }];
      },
      persist: async () => { persistCalls += 1; return ["01"]; },
    }))).rejects.toThrow(/new lint/i);
    expect(persistCalls).toBe(0);
  });

  test("rejects newly introduced dictionary audit identities before persistence", async () => {
    const records = recordsFor(["alpha"]);
    let auditCalls = 0;
    let persistCalls = 0;

    await expect(runVerificationBatch({ ...defaultOptions, write: true }, dependencies(records, {
      auditRecords: (snapshot) => {
        auditCalls += 1;
        const report = auditDictionaryRecords(snapshot);
        if (auditCalls === 1) return report;
        return {
          ...report,
          total: {
            ...report.total,
            strict: {
              ...report.total.strict,
              publishedPlaceholders: report.total.strict.publishedPlaceholders + 1,
            },
          },
          strictViolations: [
            ...report.strictViolations,
            'published-placeholder:["alpha","new-sense"]',
          ],
        };
      },
      persist: async () => { persistCalls += 1; return ["01"]; },
    }))).rejects.toThrow(/new dictionary audit/i);

    expect(persistCalls).toBe(0);
  });

  test("validates option bounds before loading records", async () => {
    let loads = 0;
    const deps = dependencies([], { loadRecords: async () => { loads += 1; return []; } });
    await expect(runVerificationBatch({ ...defaultOptions, concurrency: 6 }, deps)).rejects.toThrow(/concurrency/i);
    await expect(runVerificationBatch({ ...defaultOptions, limit: -1 }, deps)).rejects.toThrow(/limit/i);
    expect(loads).toBe(0);
  });
});
