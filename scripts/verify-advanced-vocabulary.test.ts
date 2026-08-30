import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { writeVocabularyRecords } from "../lib/vocabulary/ndjson-repository";
import type { VocabularyRecord } from "../lib/vocabulary/schema";
import { vocabularyRecordFixture } from "../lib/vocabulary/test-fixtures";
import {
  createLlmJudges,
  GraphBuildExitError,
  parseVerificationArgs,
  runVerificationCli,
  verificationExitCode,
  type VerificationCliRuntime,
} from "./verify-advanced-vocabulary";

const fixturePath = path.join(
  process.cwd(),
  "scripts/fixtures/vocabulary-verification/source-backed-batch.json",
);

function source(sourceId: "llm" | "wordnet", id: string) {
  return {
    sourceId,
    externalId: id,
    url: sourceId === "wordnet" ? `https://wordnet.example/${id}` : null,
    retrievedAt: "2026-08-29T00:00:00.000Z",
    contentHash: `sha256:${id}`,
  };
}

const fixtureCases = [
  "ambiguous-sense",
  "dictionary-direct",
  "model-relationship",
  "provider-failure",
  "tatoeba-grounded",
  "unsupported-relationship",
  "wordnet-direct",
] as const;

const exactCandidateGloss = "Model relationship  builds on core-model-relationship; exactly.";
const exactCoreGloss = "Model relationship is  an  advanced form, of core-model-relationship!";

function recordPair(lemma: string): VocabularyRecord[] {
  const fixture = vocabularyRecordFixture();
  const coreLemma = `core-${lemma}`;
  const core: VocabularyRecord = {
    ...fixture,
    lemma: coreLemma,
    display: coreLemma,
    senses: [{
      ...fixture.senses[0]!,
      id: `${coreLemma}-sense`,
      definition: `To use the basic ${lemma} action.`,
      sources: [source("wordnet", `${coreLemma}-sense`)],
      examples: [{
        text: `They use the basic ${lemma} action.`,
        sources: [source("wordnet", `${coreLemma}-example`)],
      }],
    }],
    connections: [{
      target: lemma,
      type: "advanced_form",
      gloss: lemma === "model-relationship"
        ? exactCoreGloss
        : `${lemma} is an advanced form of ${coreLemma}.`,
      sources: [source("llm", `${coreLemma}-connection`)],
      status: "published",
    }],
  };
  const advanced: VocabularyRecord = {
    ...fixture,
    lemma,
    display: lemma,
    tier: "advanced",
    forms: [`${lemma}s`],
    status: "seeded",
    publicationStatus: "hidden",
    sources: [source("llm", lemma)],
    senses: [{
      ...fixture.senses[0]!,
      id: `${lemma}-legacy`,
      definition: `A legacy ${lemma} draft.`,
      sources: [source("llm", `${lemma}-legacy`)],
      examples: [],
    }],
    pronunciation: [],
    connections: [{
      target: coreLemma,
      type: "builds_on",
      gloss: lemma === "model-relationship"
        ? exactCandidateGloss
        : `${lemma} builds on ${coreLemma}.`,
      sources: [source("llm", `${lemma}-connection`)],
      status: "published",
    }],
  };
  return [advanced, core];
}

function records(): VocabularyRecord[] {
  return fixtureCases.flatMap(recordPair);
}

async function setup(): Promise<{
  directory: string;
  vocabularyRoot: string;
  cache: string;
  report: string;
  runtime: VerificationCliRuntime;
  graphBuilds: () => number;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "ngsl-verify-cli-"));
  const vocabularyRoot = path.join(directory, "vocabulary");
  const cache = path.join(directory, "cache");
  const report = path.join(directory, "report.json");
  await writeVocabularyRecords(vocabularyRoot, records());
  let builds = 0;
  let liveCalls = 0;
  const runtime: VerificationCliRuntime = {
    vocabularyRoot,
    createCache: () => ({
      get: async () => null,
      set: async () => undefined,
    }),
    buildGraphs: async () => { builds += 1; },
    wordNet: async () => { liveCalls += 1; throw new Error("live WordNet must not be called"); },
    dictionary: async () => { liveCalls += 1; throw new Error("live dictionary must not be called"); },
    tatoeba: async () => { liveCalls += 1; throw new Error("live Tatoeba must not be called"); },
    judgeSense: async () => { liveCalls += 1; throw new Error("live sense judge must not be called"); },
    judgeRelationship: async () => { liveCalls += 1; throw new Error("live relationship judge must not be called"); },
  };
  return {
    directory,
    vocabularyRoot,
    cache,
    report,
    runtime,
    graphBuilds: () => {
      expect(liveCalls).toBe(0);
      return builds;
    },
  };
}

function args(cache: string, report: string, fixture = fixturePath, write = false): string[] {
  return [
    `--limit=${fixtureCases.length}`,
    `--cache=${cache}`,
    `--report=${report}`,
    `--fixture=${fixture}`,
    ...(write ? ["--write"] : []),
  ];
}

function liveArgs(cache: string, report: string): string[] {
  return ["--limit=1", `--cache=${cache}`, `--report=${report}`];
}

async function vocabularySnapshot(root: string): Promise<Record<string, string>> {
  const files = (await readdir(root)).filter((file) => file.endsWith(".ndjson")).sort();
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readFile(path.join(root, file), "utf8")]))) as Record<string, string>;
}

async function fixtureCacheRoot(cache: string, fixture = fixturePath): Promise<string> {
  const normalized = JSON.stringify(JSON.parse(await readFile(fixture, "utf8")) as unknown);
  const digest = createHash("sha256").update(normalized, "utf8").digest("hex");
  return path.join(cache, "fixture", digest);
}

describe("verify advanced vocabulary CLI", () => {
  test("parses bounded CLI defaults", () => {
    expect(parseVerificationArgs([])).toMatchObject({
      limit: 25,
      concurrency: 3,
      maxSourceRequests: 100,
      maxInputTokens: 20_000,
      maxOutputTokens: 8_000,
      write: false,
    });
    expect(() => parseVerificationArgs(["--concurrency=6"])).toThrow(
      "--concurrency must be an integer from 1 to 5",
    );
    expect(() => parseVerificationArgs(["--limit="])).toThrow("--limit requires a value");
    expect(() => parseVerificationArgs(["--cache="])).toThrow("--cache requires a value");
  });

  test("propagates the graph-build child exit code", () => {
    expect(verificationExitCode(new GraphBuildExitError(7))).toBe(7);
    expect(verificationExitCode(new GraphBuildExitError(null))).toBe(1);
    expect(verificationExitCode(new Error("other failure"))).toBe(1);
  });

  test("keeps model decisions unavailable without a key or a valid model result", async () => {
    const options = parseVerificationArgs(["--max-output-tokens=90"]);
    let completionCalls = 0;
    const unavailable = createLlmJudges(options, {
      available: false,
      model: "test-model",
      complete: async () => {
        completionCalls += 1;
        return null;
      },
    });
    expect(unavailable).toEqual({ judgeSense: null, judgeRelationship: null });
    expect(completionCalls).toBe(0);

    const requestIds: string[] = [];
    const broken = createLlmJudges(options, {
      available: true,
      model: "test-model",
      complete: async (_system, _user, _model, attempts, resultOptions) => {
        completionCalls += 1;
        expect(attempts).toBe(2);
        expect(resultOptions.maxOutputTokens).toBe(90);
        expect(resultOptions.sanitizeErrors).toBe(true);
        requestIds.push(resultOptions.requestId!);
        return null;
      },
    });
    const senseRequest = {
      candidate: { lemma: "test-word", partOfSpeech: "verb", forms: ["test-words"] },
      senses: [{ id: "sense-1", partOfSpeech: "verb", definition: "To test." }],
      examples: [{ id: "example-1", text: "They test-word the result." }],
    };
    await expect(broken.judgeSense!(senseRequest)).rejects.toThrow("LLM sense judge unavailable");
    await expect(broken.judgeSense!(senseRequest)).rejects.toThrow("LLM sense judge unavailable");
    expect(requestIds[0]).toBe(requestIds[1]);
  });

  test("gives live judges exact finite JSON contracts and accepts contract-shaped decisions", async () => {
    const systems: string[] = [];
    const judges = createLlmJudges(parseVerificationArgs([]), {
      available: true,
      model: "test-model",
      complete: async (system, user, _model, _attempts, options) => {
        systems.push(system);
        const request = JSON.parse(user) as Record<string, unknown>;
        const value = "candidate" in request
          ? {
              decision: "selected",
              senseId: (request.senses as Array<{ id: string }>)[0]!.id,
              exampleId: (request.examples as Array<{ id: string }>)[0]!.id,
            }
          : {
              decision: "supported",
              candidateSenseId: request.candidateSenseId,
              coreLemma: request.coreLemma,
            };
        return {
          value,
          usage: { inputTokens: 7, outputTokens: 3 },
          requestId: options.requestId!,
        };
      },
    });

    await expect(judges.judgeSense!({
      candidate: { lemma: "test-word", partOfSpeech: "verb", forms: ["test-words"] },
      senses: [{ id: "sense-1", partOfSpeech: "verb", definition: "To test." }],
      examples: [{ id: "example-1", text: "They test the result." }],
    })).resolves.toMatchObject({
      decision: { decision: "selected", senseId: "sense-1", exampleId: "example-1" },
    });
    await expect(judges.judgeRelationship!({
      candidateSenseId: "sense-1",
      coreLemma: "core-word",
      relationship: {
        candidateType: "builds_on",
        coreType: "advanced_form",
        candidateGloss: "A precise gloss.",
        coreGloss: "The reciprocal gloss.",
      },
      senses: [
        { role: "candidate", lemma: "test-word", id: "sense-1", partOfSpeech: "verb", definition: "To test." },
        { role: "core", lemma: "core-word", id: "core-sense", partOfSpeech: "verb", definition: "To inspect." },
      ],
    })).resolves.toMatchObject({
      decision: { decision: "supported", candidateSenseId: "sense-1", coreLemma: "core-word" },
    });

    expect(systems[0]).toContain('"decision":"selected"');
    expect(systems[0]).toContain('"exampleId"');
    expect(systems[1]).toContain('"candidateSenseId"');
    expect(systems[1]).toContain('"coreLemma"');
  });

  test("keeps a fixture dry-run side-effect free and pins its successful batch", async () => {
    const value = await setup();
    try {
      const before = await vocabularySnapshot(value.vocabularyRoot);
      const result = await runVerificationCli(args(value.cache, value.report), value.runtime);

      expect(result.report).toMatchObject({ mode: "dry-run", selected: 7, attempted: 7 });
      expect(await vocabularySnapshot(value.vocabularyRoot)).toEqual(before);
      expect(await readFile(path.join(await fixtureCacheRoot(value.cache), "active-batch-v3.json"), "utf8"))
        .toContain("dictionary-direct");
      expect(value.graphBuilds()).toBe(0);
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  });

  test("covers every required offline verification outcome and preserves reciprocal gloss bytes", async () => {
    const value = await setup();
    try {
      const result = await runVerificationCli(args(value.cache, value.report), value.runtime);

      expect(result.outcomes.map(({ candidateLemma, reason }) => [candidateLemma, reason])).toEqual([
        ["ambiguous-sense", "sense_ambiguous"],
        ["dictionary-direct", "published"],
        ["model-relationship", "published"],
        ["provider-failure", "provider_failed"],
        ["tatoeba-grounded", "published"],
        ["unsupported-relationship", "relationship_unsupported"],
        ["wordnet-direct", "published"],
      ]);
      expect(result.report).toMatchObject({
        selected: 7,
        attempted: 7,
        sourceBacked: 6,
        published: 4,
        ambiguous: 1,
        unsupported: 1,
        failed: 1,
        relationships: { accepted: 4, rejected: 1, ambiguous: 2 },
      });
      const modelRelationship = result.outcomes.find(
        (outcome) => outcome.candidateLemma === "model-relationship",
      );
      expect(modelRelationship?.relationships).toEqual([expect.objectContaining({
        method: "llm_consensus",
        candidateGloss: exactCandidateGloss,
        coreGloss: exactCoreGloss,
      })]);
      expect(result.outcomes.find(
        (outcome) => outcome.candidateLemma === "unsupported-relationship",
      )?.relationships).toEqual([expect.objectContaining({
        decision: "unsupported",
        method: "llm_consensus",
      })]);
      expect(result.outcomes.find(
        (outcome) => outcome.candidateLemma === "tatoeba-grounded",
      )?.selectedExample?.source.sourceId).toBe("tatoeba");
      expect(value.graphBuilds()).toBe(0);
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  });

  test("reserves fixture-declared usage instead of live-model estimates", async () => {
    const value = await setup();
    try {
      const result = await runVerificationCli([
        ...args(value.cache, value.report),
        "--max-input-tokens=100",
        "--max-output-tokens=30",
      ], value.runtime);

      expect(result.report).toMatchObject({
        selected: 7,
        attempted: 7,
        published: 4,
        ambiguous: 1,
        unsupported: 1,
        failed: 1,
      });
      expect(value.graphBuilds()).toBe(0);
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  });

  test("fails closed for a missing fixture key without calling a live adapter", async () => {
    const value = await setup();
    const incompleteFixture = path.join(value.directory, "missing-dictionary.json");
    try {
      const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { dictionaryapi: Record<string, unknown> };
      delete fixture.dictionaryapi["dictionary-direct"];
      await writeFile(incompleteFixture, JSON.stringify(fixture), "utf8");

      const result = await runVerificationCli(args(value.cache, value.report, incompleteFixture), value.runtime);
      expect(result.report.entries).toContainEqual({ lemma: "dictionary-direct", reason: "provider_failed" });
      expect(value.graphBuilds()).toBe(0);
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  });

  test("rejects non-normalized fixture payloads before verification", async () => {
    const value = await setup();
    const malformedFixture = path.join(value.directory, "raw-provider-payload.json");
    try {
      const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
        dictionaryapi: Record<string, { value: unknown }>;
      };
      fixture.dictionaryapi["dictionary-direct"] = {
        value: { raw: { providerResponse: "must not be retained" } },
      };
      await writeFile(malformedFixture, JSON.stringify(fixture), "utf8");

      await expect(runVerificationCli(
        args(value.cache, value.report, malformedFixture),
        value.runtime,
      )).rejects.toThrow("verification fixture is invalid");
      expect(value.graphBuilds()).toBe(0);
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  });

  test("writes the pinned batch once and rebuilds once without advancing candidates", async () => {
    const value = await setup();
    try {
      const dryRun = await runVerificationCli(args(value.cache, value.report), value.runtime);
      const firstWrite = await runVerificationCli(args(value.cache, value.report, fixturePath, true), value.runtime);
      const secondWrite = await runVerificationCli(args(value.cache, value.report, fixturePath, true), value.runtime);

      expect(firstWrite.batch).toEqual(dryRun.batch);
      expect(firstWrite.report.changedShards.length).toBeGreaterThan(0);
      expect(secondWrite.report.entries.map((entry) => entry.lemma)).toEqual([...fixtureCases]);
      expect(secondWrite.report.changedShards).toEqual([]);
      expect(value.graphBuilds()).toBe(1);
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  });

  test("recovers an unfinished graph build after canonical persistence", async () => {
    const value = await setup();
    let buildAttempts = 0;
    const runtime: VerificationCliRuntime = {
      ...value.runtime,
      buildGraphs: async () => {
        buildAttempts += 1;
        if (buildAttempts === 1) throw new Error("graph build failed");
      },
    };
    try {
      await runVerificationCli(args(value.cache, value.report), runtime);
      await expect(runVerificationCli(
        args(value.cache, value.report, fixturePath, true),
        runtime,
      )).rejects.toThrow("graph build failed");

      const recovered = await runVerificationCli(
        args(value.cache, value.report, fixturePath, true),
        runtime,
      );
      const repeated = await runVerificationCli(
        args(value.cache, value.report, fixturePath, true),
        runtime,
      );

      expect(recovered.report.changedShards).toEqual([]);
      expect(repeated.report.changedShards).toEqual([]);
      expect(buildAttempts).toBe(2);
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  });

  test("rejects replay when the pinned configuration changes", async () => {
    const value = await setup();
    const mutableFixture = path.join(value.directory, "mutable-fixture.json");
    try {
      const original = JSON.parse(await readFile(fixturePath, "utf8")) as {
        relationship: Record<string, { decision: { decision: string } }>;
      };
      await writeFile(mutableFixture, JSON.stringify(original), "utf8");
      await runVerificationCli(args(value.cache, value.report, mutableFixture), value.runtime);
      const before = await vocabularySnapshot(value.vocabularyRoot);

      await expect(runVerificationCli(
        [...args(value.cache, value.report, mutableFixture, true), "--concurrency=2"],
        value.runtime,
      )).rejects.toThrow(/active verification batch configuration changed/i);
      expect(await vocabularySnapshot(value.vocabularyRoot)).toEqual(before);
      expect(value.graphBuilds()).toBe(0);
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  });

  test("namespaces fixture cache state by the fixture digest", async () => {
    const value = await setup();
    const changedFixture = path.join(value.directory, "changed-fixture.json");
    try {
      const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
        dictionaryapi: Record<string, unknown>;
      };
      await runVerificationCli(args(value.cache, value.report), value.runtime);
      delete fixture.dictionaryapi["dictionary-direct"];
      await writeFile(changedFixture, JSON.stringify(fixture), "utf8");

      const changed = await runVerificationCli(
        args(value.cache, value.report, changedFixture),
        value.runtime,
      );
      expect(changed.report.entries).toContainEqual({
        lemma: "dictionary-direct",
        reason: "provider_failed",
      });
      expect((await readdir(path.join(value.cache, "fixture"))).sort()).toEqual([
        path.basename(await fixtureCacheRoot(value.cache, changedFixture)),
        path.basename(await fixtureCacheRoot(value.cache)),
      ].sort());
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  });

  test("rejects write mode until a successful dry-run has pinned the batch", async () => {
    const value = await setup();
    try {
      const before = await vocabularySnapshot(value.vocabularyRoot);

      await expect(runVerificationCli(
        args(value.cache, value.report, fixturePath, true),
        value.runtime,
      )).rejects.toThrow("--write requires a successful dry-run");

      expect(await vocabularySnapshot(value.vocabularyRoot)).toEqual(before);
      expect(value.graphBuilds()).toBe(0);
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  });

  test("does not pin a first batch when its report cannot be written", async () => {
    const value = await setup();
    try {
      await expect(runVerificationCli(
        args(value.cache, value.directory),
        value.runtime,
      )).rejects.toBeInstanceOf(Error);

      await expect(readFile(
        path.join(await fixtureCacheRoot(value.cache), "active-batch-v3.json"),
        "utf8",
      )).rejects.toMatchObject({ code: "ENOENT" });
      expect(value.graphBuilds()).toBe(0);
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  });

  test("does not replace an active batch created by a concurrent invocation", async () => {
    const value = await setup();
    try {
      const settled = await Promise.allSettled([
        runVerificationCli(args(value.cache, value.report), value.runtime),
        runVerificationCli(args(value.cache, value.report), value.runtime),
      ]);

      expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(await readFile(path.join(await fixtureCacheRoot(value.cache), "active-batch-v3.json"), "utf8"))
        .toContain("dictionary-direct");
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  });

  test("does not let a provider-failed live dry-run authorize a write", async () => {
    const value = await setup();
    const liveVocabularyRoot = path.join(value.directory, "live-vocabulary");
    try {
      await runVerificationCli(args(value.cache, value.report), value.runtime);
      await writeVocabularyRecords(liveVocabularyRoot, recordPair("live-only"));
      const before = await vocabularySnapshot(liveVocabularyRoot);
      const liveRuntime = { ...value.runtime, vocabularyRoot: liveVocabularyRoot };

      const live = await runVerificationCli(
        liveArgs(value.cache, path.join(value.directory, "live-report.json")),
        liveRuntime,
      );

      expect(live.report.entries).toEqual([{ lemma: "live-only", reason: "provider_failed" }]);
      await expect(readFile(path.join(value.cache, "active-batch-v3.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      await expect(runVerificationCli(
        [...liveArgs(value.cache, path.join(value.directory, "live-write-report.json")), "--write"],
        liveRuntime,
      )).rejects.toThrow("--write requires a successful dry-run");
      expect(await vocabularySnapshot(liveVocabularyRoot)).toEqual(before);
      expect(await readFile(path.join(await fixtureCacheRoot(value.cache), "active-batch-v3.json"), "utf8"))
        .toContain("dictionary-direct");
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  });

  test("pins a healthy live dry-run in the v3 manifest", async () => {
    const value = await setup();
    const liveVocabularyRoot = path.join(value.directory, "healthy-live-vocabulary");
    try {
      await writeVocabularyRecords(liveVocabularyRoot, recordPair("wordnet-direct"));
      const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
        wordnet: Record<string, { value: unknown }>;
      };
      const wordNetEvidence = fixture.wordnet["wordnet-direct"]!.value as Awaited<
        ReturnType<VerificationCliRuntime["wordNet"]>
      >;
      const liveRuntime: VerificationCliRuntime = {
        ...value.runtime,
        vocabularyRoot: liveVocabularyRoot,
        wordNet: async () => wordNetEvidence,
        dictionary: async () => null,
        tatoeba: async () => [],
        judgeSense: null,
        judgeRelationship: null,
      };

      const live = await runVerificationCli(
        liveArgs(value.cache, path.join(value.directory, "healthy-live-report.json")),
        liveRuntime,
      );

      expect(live.report).toMatchObject({ published: 1, failed: 0 });
      expect(JSON.parse(await readFile(
        path.join(value.cache, "active-batch-v3.json"),
        "utf8",
      ))).toMatchObject({ version: 3, graphStatus: "ready" });
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  });
});
