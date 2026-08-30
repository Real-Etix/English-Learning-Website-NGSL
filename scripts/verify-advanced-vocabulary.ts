import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import WordPOS from "wordpos";
import { z } from "zod";

import { openNdjsonRepository, writeVocabularyRecords } from "../lib/vocabulary/ndjson-repository";
import { type VerificationCache, createVerificationCache } from "../lib/vocabulary/verification/cache";
import { RelationshipDecisionSchema, SenseSelectionDecisionSchema } from "../lib/vocabulary/verification/decision-schema";
import { fetchDictionaryEvidence, fetchTatoebaExamples } from "../lib/vocabulary/verification/http-providers";
import { VerificationReportSchema } from "../lib/vocabulary/verification/report";
import {
  VerificationBatchEntrySchema,
  runVerificationBatch,
  type VerificationDependencies,
  type VerificationRunResult,
} from "../lib/vocabulary/verification/run-batch";
import { type RelationshipJudge, type RelationshipJudgeRequest } from "../lib/vocabulary/verification/relationship-verifier";
import { type SenseJudge, type SenseJudgeRequest } from "../lib/vocabulary/verification/sense-verifier";
import { lookupWordNetEvidence, type WordNetLookup } from "../lib/vocabulary/verification/wordnet-provider";
import {
  completeJSONResult,
  hasLLM,
  LLM_ENDPOINT,
  LLM_MODEL,
  type LlmResult,
  type LlmResultOptions,
} from "./llm-client";

const ACTIVE_BATCH_FILENAME = "active-batch-v3.json";
const DEFAULT_CACHE = ".cache/vocabulary-verification";
const DEFAULT_REPORT = ".cache/vocabulary-verification/latest-report.json";
const DEFAULT_LIMIT = 25;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_SOURCE_REQUESTS = 100;
const DEFAULT_MAX_INPUT_TOKENS = 20_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_000;

const FixtureFailureSchema = z.object({ error: z.literal("provider_failed") }).strict();
const FixtureUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
}).strict();
const FixtureDictionarySourceSchema = z.object({
  sourceId: z.enum(["wordnet", "dictionaryapi"]),
  url: z.url().nullable(),
  retrievedAt: z.iso.datetime().nullable(),
  contentHash: z.string().nullable(),
}).strict();
const FixtureContentSourceSchema = z.object({
  sourceId: z.literal("tatoeba"),
  externalId: z.string().nullable(),
  url: z.url().nullable(),
  retrievedAt: z.iso.datetime().nullable(),
  contentHash: z.string().nullable(),
}).strict();
const FixtureSourceMetadataSchema = z.object({
  entryId: z.string().optional(),
  url: z.url().nullable().optional(),
}).strict();
const FixtureWordDetailSchema = z.object({
  ipa: z.string().nullable(),
  audioUk: z.url().nullable(),
  audioUs: z.url().nullable(),
  audioAny: z.url().nullable(),
  sourceEntryId: z.string().optional(),
  sourceUrl: z.url().nullable().optional(),
  pronunciationSources: z.object({
    ipa: FixtureSourceMetadataSchema.optional(),
    audioUk: FixtureSourceMetadataSchema.optional(),
    audioUs: FixtureSourceMetadataSchema.optional(),
    audioAny: FixtureSourceMetadataSchema.optional(),
  }).strict().optional(),
  senses: z.array(z.object({
    partOfSpeech: z.string(),
    definition: z.string(),
    example: z.string().nullable(),
    sourceEntryId: z.string().optional(),
    sourceSenseId: z.string().optional(),
    sourceUrl: z.url().nullable().optional(),
  }).strict()),
  synonyms: z.array(z.string()),
}).strict();
const FixtureDictionaryEvidenceSchema = z.object({
  provider: z.enum(["wordnet", "dictionaryapi"]),
  returnedLemma: z.string().min(1),
  requestedPartOfSpeech: z.string().min(1),
  detail: FixtureWordDetailSchema,
  source: FixtureDictionarySourceSchema,
}).strict().superRefine((value, context) => {
  if (value.provider !== value.source.sourceId) {
    context.addIssue({ code: "custom", message: "provider/source mismatch", path: ["source", "sourceId"] });
  }
});
const fixtureDictionaryEntry = (provider: "wordnet" | "dictionaryapi") => z.union([
  FixtureFailureSchema,
  z.object({ value: FixtureDictionaryEvidenceSchema.nullable() }).strict().superRefine((entry, context) => {
    if (entry.value !== null && entry.value.provider !== provider) {
      context.addIssue({ code: "custom", message: `expected ${provider} evidence`, path: ["value", "provider"] });
    }
  }),
]);
const FixtureTatoebaEntrySchema = z.union([
  FixtureFailureSchema,
  z.object({
    value: z.array(z.object({
      id: z.string().min(1),
      text: z.string().min(1),
      language: z.literal("eng"),
      source: FixtureContentSourceSchema,
    }).strict()),
  }).strict(),
]);
const FixtureSchema = z.object({
  version: z.literal(1),
  wordnet: z.record(z.string().min(1), fixtureDictionaryEntry("wordnet")),
  dictionaryapi: z.record(z.string().min(1), fixtureDictionaryEntry("dictionaryapi")),
  tatoeba: z.record(z.string().min(1), FixtureTatoebaEntrySchema),
  sense: z.record(z.string().min(1), z.object({
    decision: SenseSelectionDecisionSchema,
    usage: FixtureUsageSchema,
  }).strict()),
  relationship: z.record(z.string().min(1), z.object({
    decision: RelationshipDecisionSchema,
    usage: FixtureUsageSchema,
  }).strict()),
  reciprocalGlosses: z.object({
    candidate: z.string().refine((value) => value.trim().length > 0),
    core: z.string().refine((value) => value.trim().length > 0),
  }).strict(),
}).strict();
type VerificationFixture = z.infer<typeof FixtureSchema>;

const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const VerificationIdentitySchema = z.object({
  version: z.literal(1),
  limit: z.number().int().nonnegative(),
  concurrency: z.number().int().min(1).max(5),
  maxSourceRequests: z.number().int().nonnegative(),
  maxInputTokens: z.number().int().nonnegative(),
  maxOutputTokens: z.number().int().nonnegative(),
  modelId: z.string().min(1),
  fixtureHash: Sha256Schema.nullable(),
  endpointHash: Sha256Schema.nullable(),
}).strict();
type VerificationIdentity = z.infer<typeof VerificationIdentitySchema>;

const ActiveBatchManifestSchema = z.object({
  version: z.literal(3),
  identity: VerificationIdentitySchema,
  batch: z.array(VerificationBatchEntrySchema),
  graphStatus: z.enum(["ready", "pending", "complete"]),
}).strict();
type ActiveBatchManifest = z.infer<typeof ActiveBatchManifestSchema>;

export type VerificationCliOptions = {
  limit: number;
  concurrency: number;
  maxSourceRequests: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  cache: string;
  report: string;
  fixture: string | null;
  write: boolean;
};

export type VerificationCliRuntime = {
  vocabularyRoot: string;
  createCache(root: string): VerificationCache;
  buildGraphs(): Promise<void>;
  wordNet: VerificationDependencies["getWordNet"];
  dictionary: VerificationDependencies["getDictionary"];
  tatoeba: VerificationDependencies["getTatoeba"];
  judgeSense: SenseJudge | null;
  judgeRelationship: RelationshipJudge | null;
};

function integer(value: string, option: string, minimum: number, maximum?: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || (maximum !== undefined && parsed > maximum)) {
    const range = maximum === undefined ? `at least ${minimum}` : `from ${minimum} to ${maximum}`;
    throw new Error(`${option} must be an integer ${range}`);
  }
  return parsed;
}

function optionValue(argv: readonly string[], index: number, name: string): { value: string; nextIndex: number } {
  const argument = argv[index]!;
  const prefix = `${name}=`;
  if (argument.startsWith(prefix)) {
    const value = argument.slice(prefix.length);
    if (!value) throw new Error(`${name} requires a value`);
    return { value, nextIndex: index };
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return { value, nextIndex: index + 1 };
}

/** Parses the local-only command surface without reading environment variables. */
export function parseVerificationArgs(argv: readonly string[]): VerificationCliOptions {
  const options: VerificationCliOptions = {
    limit: DEFAULT_LIMIT,
    concurrency: DEFAULT_CONCURRENCY,
    maxSourceRequests: DEFAULT_MAX_SOURCE_REQUESTS,
    maxInputTokens: DEFAULT_MAX_INPUT_TOKENS,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    cache: DEFAULT_CACHE,
    report: DEFAULT_REPORT,
    fixture: null,
    write: false,
  };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--write") {
      if (seen.has(argument)) throw new Error("--write may only be provided once");
      seen.add(argument);
      options.write = true;
      continue;
    }
    const name = argument.includes("=") ? argument.slice(0, argument.indexOf("=")) : argument;
    if (![
      "--limit", "--concurrency", "--max-source-requests", "--max-input-tokens", "--max-output-tokens",
      "--cache", "--report", "--fixture",
    ].includes(name)) throw new Error(`Unknown option: ${argument}`);
    if (seen.has(name)) throw new Error(`${name} may only be provided once`);
    seen.add(name);
    const { value, nextIndex } = optionValue(argv, index, name);
    index = nextIndex;
    switch (name) {
      case "--limit": options.limit = integer(value, name, 0); break;
      case "--concurrency": options.concurrency = integer(value, name, 1, 5); break;
      case "--max-source-requests": options.maxSourceRequests = integer(value, name, 0); break;
      case "--max-input-tokens": options.maxInputTokens = integer(value, name, 0); break;
      case "--max-output-tokens": options.maxOutputTokens = integer(value, name, 0); break;
      case "--cache": options.cache = value; break;
      case "--report": options.report = value; break;
      case "--fixture": options.fixture = value; break;
    }
  }
  return options;
}

function fromWorkingDirectory(value: string): string {
  return path.resolve(process.cwd(), value);
}

function fixtureEntry(
  fixture: VerificationFixture,
  category: "wordnet" | "dictionaryapi" | "tatoeba",
  lemma: string,
): unknown {
  const entry = fixture[category][lemma];
  if (!entry) throw new Error(`fixture entry is required for ${category}:${lemma}`);
  if ("error" in entry) throw new Error("fixture provider failed");
  return entry.value;
}

function fixtureSenseJudge(fixture: VerificationFixture): SenseJudge {
  return async (request) => {
    const entry = fixture.sense[request.candidate.lemma];
    if (!entry) throw new Error(`fixture entry is required for sense:${request.candidate.lemma}`);
    return entry;
  };
}

function fixtureRelationshipJudge(fixture: VerificationFixture): RelationshipJudge {
  return async (request) => {
    const key = `${request.senses.find((sense) => sense.role === "candidate")?.lemma ?? ""}|${request.coreLemma}`;
    const entry = fixture.relationship[key];
    if (!entry) throw new Error(`fixture entry is required for relationship:${key}`);
    return entry;
  };
}

async function loadFixture(filePath: string): Promise<VerificationFixture> {
  const parsed = FixtureSchema.safeParse(JSON.parse(await readFile(filePath, "utf8")) as unknown);
  if (!parsed.success) throw new Error("verification fixture is invalid");
  return parsed.data;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function verificationIdentity(
  options: VerificationCliOptions,
  fixture: VerificationFixture | null,
): VerificationIdentity {
  return VerificationIdentitySchema.parse({
    version: 1,
    limit: options.limit,
    concurrency: options.concurrency,
    maxSourceRequests: options.maxSourceRequests,
    maxInputTokens: options.maxInputTokens,
    maxOutputTokens: options.maxOutputTokens,
    modelId: fixture ? "fixture" : LLM_MODEL,
    fixtureHash: fixture ? sha256(JSON.stringify(fixture)) : null,
    endpointHash: fixture ? null : sha256(LLM_ENDPOINT),
  });
}

async function readActiveBatch(cacheRoot: string, identity: VerificationIdentity) {
  let manifest: ActiveBatchManifest;
  try {
    const value = JSON.parse(await readFile(path.join(cacheRoot, ACTIVE_BATCH_FILENAME), "utf8")) as unknown;
    manifest = ActiveBatchManifestSchema.parse(value);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
    throw new Error("active verification batch manifest is invalid");
  }
  if (JSON.stringify(manifest.identity) !== JSON.stringify(identity)) {
    throw new Error("active verification batch configuration changed");
  }
  return manifest;
}

async function writeAtomically(filePath: string, value: string): Promise<void> {
  const directory = path.dirname(filePath);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, value, "utf8");
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function createAtomically(filePath: string, value: string): Promise<void> {
  const directory = path.dirname(filePath);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, value, "utf8");
    await link(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function writeActiveBatch(
  cacheRoot: string,
  identity: VerificationIdentity,
  batch: VerificationRunResult["batch"],
): Promise<void> {
  const manifest = ActiveBatchManifestSchema.parse({
    version: 3,
    identity,
    batch,
    graphStatus: "ready",
  });
  try {
    await createAtomically(path.join(cacheRoot, ACTIVE_BATCH_FILENAME), `${JSON.stringify(manifest)}\n`);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      throw new Error("active verification batch was created concurrently; rerun to use the pinned batch");
    }
    throw error;
  }
}

async function updateActiveBatchStatus(
  cacheRoot: string,
  manifest: ActiveBatchManifest,
  graphStatus: ActiveBatchManifest["graphStatus"],
): Promise<ActiveBatchManifest> {
  const updated = ActiveBatchManifestSchema.parse({ ...manifest, graphStatus });
  await writeAtomically(
    path.join(cacheRoot, ACTIVE_BATCH_FILENAME),
    `${JSON.stringify(updated)}\n`,
  );
  return updated;
}

async function writeReport(filePath: string, result: VerificationRunResult): Promise<void> {
  const report = VerificationReportSchema.parse(result.report);
  await writeAtomically(filePath, `${JSON.stringify(report, null, 2)}\n`);
}

function liveRunAllowsWrite(result: VerificationRunResult): boolean {
  const infrastructureFailures = new Set([
    "provider_failed",
    "judge_unavailable",
    "budget_exhausted",
  ]);
  return !result.outcomes.some((outcome) =>
    infrastructureFailures.has(outcome.reason)
    || outcome.relationships.some((relationship) =>
      relationship.reason !== null && infrastructureFailures.has(relationship.reason),
    ),
  );
}

function fallbackUsage(options: VerificationCliOptions) {
  return {
    inputTokens: Math.min(2_000, options.maxInputTokens),
    outputTokens: Math.min(200, options.maxOutputTokens),
  };
}

function fixtureUsage(
  entries: Record<string, { usage: { inputTokens: number; outputTokens: number } }>,
) {
  return Object.values(entries).reduce((maximum, entry) => ({
    inputTokens: Math.max(maximum.inputTokens, entry.usage.inputTokens),
    outputTokens: Math.max(maximum.outputTokens, entry.usage.outputTokens),
  }), { inputTokens: 0, outputTokens: 0 });
}

function stableRequestId(task: "sense" | "relationship", request: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(request), "utf8").digest("hex");
  return `verification:${task}:${hash.slice(0, 24)}`;
}

type CompleteJsonDecision = (
  system: string,
  user: string,
  model: string,
  maxAttempts: number,
  options: LlmResultOptions,
) => Promise<LlmResult<unknown> | null>;

export type LlmJudgeDependencies = {
  available: boolean;
  model: string;
  complete: CompleteJsonDecision;
};

const SENSE_JUDGE_SYSTEM = [
  "Choose only IDs supplied in the request; never author or rewrite learner content.",
  "Return exactly one of these JSON objects with no additional fields or prose:",
  '{"decision":"selected","senseId":"<one supplied senses[].id>","exampleId":"<one supplied examples[].id>"}',
  '{"decision":"selected","senseId":"<one supplied senses[].id>","exampleId":null}',
  '{"decision":"ambiguous","senseId":null,"exampleId":null}',
].join("\n");

const RELATIONSHIP_JUDGE_SYSTEM = [
  "Assess only the supplied candidate sense, core senses, and reciprocal relationship.",
  "Return exactly one of these JSON objects with no additional fields or prose:",
  '{"decision":"supported","candidateSenseId":"<exact supplied candidateSenseId>","coreLemma":"<exact supplied coreLemma>"}',
  '{"decision":"unsupported","candidateSenseId":"<exact supplied candidateSenseId>","coreLemma":"<exact supplied coreLemma>"}',
  '{"decision":"ambiguous","candidateSenseId":"<exact supplied candidateSenseId>","coreLemma":"<exact supplied coreLemma>"}',
].join("\n");

export function createLlmJudges(
  options: VerificationCliOptions,
  dependencies: LlmJudgeDependencies = {
    available: hasLLM(),
    model: LLM_MODEL,
    complete: (system, user, model, maxAttempts, resultOptions) =>
      completeJSONResult<unknown>(system, user, model, maxAttempts, resultOptions),
  },
): Pick<VerificationCliRuntime, "judgeSense" | "judgeRelationship"> {
  if (
    !dependencies.available
    || options.maxInputTokens === 0
    || options.maxOutputTokens === 0
  ) return { judgeSense: null, judgeRelationship: null };

  const judgeSense: SenseJudge = async (request: SenseJudgeRequest) => {
    const usage = fallbackUsage(options);
    const result = await dependencies.complete(
      SENSE_JUDGE_SYSTEM,
      JSON.stringify(request),
      dependencies.model,
      2,
      {
        requestId: stableRequestId("sense", request),
        fallbackUsage: usage,
        maxOutputTokens: usage.outputTokens,
        sanitizeErrors: true,
      },
    );
    if (!result) throw new Error("LLM sense judge unavailable");
    return { decision: result.value, usage: result.usage };
  };

  const judgeRelationship: RelationshipJudge = async (request: RelationshipJudgeRequest) => {
    const usage = fallbackUsage(options);
    const result = await dependencies.complete(
      RELATIONSHIP_JUDGE_SYSTEM,
      JSON.stringify(request),
      dependencies.model,
      2,
      {
        requestId: stableRequestId("relationship", request),
        fallbackUsage: usage,
        maxOutputTokens: usage.outputTokens,
        sanitizeErrors: true,
      },
    );
    if (!result) throw new Error("LLM relationship judge unavailable");
    return { decision: result.value, usage: result.usage };
  };

  return { judgeSense, judgeRelationship };
}

/** Runs a deterministic local verification batch. Fixture adapters never delegate to live adapters. */
export async function runVerificationCli(
  argv: readonly string[],
  runtime: VerificationCliRuntime,
): Promise<VerificationRunResult> {
  const options = parseVerificationArgs(argv);
  const reportPath = fromWorkingDirectory(options.report);
  const fixture = options.fixture === null ? null : await loadFixture(fromWorkingDirectory(options.fixture));
  const requestedCacheRoot = fromWorkingDirectory(options.cache);
  const identity = verificationIdentity(options, fixture);
  const cacheRoot = fixture === null
    ? requestedCacheRoot
    : path.join(requestedCacheRoot, "fixture", identity.fixtureHash!.slice("sha256:".length));
  let manifest = await readActiveBatch(cacheRoot, identity);
  if (options.write && manifest === null) {
    throw new Error("--write requires a successful dry-run that pins the active batch");
  }
  const retryGraphBuild = options.write && manifest?.graphStatus === "pending";
  if (options.write && manifest) {
    manifest = await updateActiveBatchStatus(cacheRoot, manifest, "pending");
  }
  const batch = manifest?.batch ?? null;
  const repository = openNdjsonRepository(runtime.vocabularyRoot);
  const estimatedSenseUsage = fixture
    ? fixtureUsage(fixture.sense)
    : fallbackUsage(options);
  const estimatedRelationshipUsage = fixture
    ? fixtureUsage(fixture.relationship)
    : fallbackUsage(options);

  const result = await runVerificationBatch({
    limit: options.limit,
    concurrency: options.concurrency,
    maxSourceRequests: options.maxSourceRequests,
    maxInputTokens: options.maxInputTokens,
    maxOutputTokens: options.maxOutputTokens,
    write: options.write,
    ...(retryGraphBuild ? { rebuildGraphs: true } : {}),
    ...(batch === null ? {} : { batch }),
  }, {
    loadRecords: async () => {
      const records = [];
      for await (const record of repository.all()) records.push(record);
      return records;
    },
    cache: runtime.createCache(cacheRoot),
    getWordNet: fixture
      ? async (candidate) => fixtureEntry(fixture, "wordnet", candidate.record.lemma) as ReturnType<VerificationDependencies["getWordNet"]> extends Promise<infer T> ? T : never
      : runtime.wordNet,
    getDictionary: fixture
      ? async (candidate) => fixtureEntry(fixture, "dictionaryapi", candidate.record.lemma) as ReturnType<VerificationDependencies["getDictionary"]> extends Promise<infer T> ? T : never
      : runtime.dictionary,
    getTatoeba: fixture
      ? async (candidate) => fixtureEntry(fixture, "tatoeba", candidate.record.lemma) as ReturnType<VerificationDependencies["getTatoeba"]> extends Promise<infer T> ? T : never
      : runtime.tatoeba,
    judgeSense: fixture ? fixtureSenseJudge(fixture) : runtime.judgeSense,
    judgeRelationship: fixture ? fixtureRelationshipJudge(fixture) : runtime.judgeRelationship,
    estimatedSenseUsage,
    estimatedRelationshipUsage,
    modelId: fixture ? "fixture" : LLM_MODEL,
    persist: (updates) => writeVocabularyRecords(runtime.vocabularyRoot, updates),
    buildGraphs: runtime.buildGraphs,
  });

  if (options.write && manifest) {
    manifest = await updateActiveBatchStatus(cacheRoot, manifest, "complete");
  }
  await writeReport(reportPath, result);
  if (batch === null && (fixture !== null || liveRunAllowsWrite(result))) {
    await writeActiveBatch(cacheRoot, identity, result.batch);
  }
  return result;
}

function buildGraphs(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "build:graphs"], { cwd: process.cwd(), stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new GraphBuildExitError(code)));
  });
}

export class GraphBuildExitError extends Error {
  readonly exitCode: number;

  constructor(code: number | null) {
    const exitCode = typeof code === "number" && code > 0 ? code : 1;
    super(`build:graphs exited with code ${code ?? "unknown"}`);
    this.name = "GraphBuildExitError";
    this.exitCode = exitCode;
  }
}

export function verificationExitCode(error: unknown): number {
  return error instanceof GraphBuildExitError ? error.exitCode : 1;
}

function productionRuntime(options: VerificationCliOptions): VerificationCliRuntime {
  const wordPos = new WordPOS() as WordNetLookup;
  const judges = createLlmJudges(options);
  return {
    vocabularyRoot: path.join(process.cwd(), "content", "vocabulary"),
    createCache: createVerificationCache,
    buildGraphs,
    wordNet: (candidate) => lookupWordNetEvidence(candidate.record.lemma, candidate.record.partOfSpeech, {
      lookup: wordPos,
      retrievedAt: null,
    }),
    dictionary: (candidate) => fetchDictionaryEvidence(candidate.record.lemma, candidate.record.partOfSpeech),
    tatoeba: (candidate) => fetchTatoebaExamples(candidate.record.lemma, candidate.record.forms),
    ...judges,
  };
}

async function main(): Promise<void> {
  const options = parseVerificationArgs(process.argv.slice(2));
  const result = await runVerificationCli(process.argv.slice(2), productionRuntime(options));
  const entries = result.report.entries.slice(0, 25).map((entry) => `${entry.lemma}:${entry.reason}`).join(", ");
  console.log(`Verification ${result.report.mode}: selected=${result.report.selected}, attempted=${result.report.attempted}, published=${result.report.published}, ambiguous=${result.report.ambiguous}, unsupported=${result.report.unsupported}, failed=${result.report.failed}.`);
  console.log(`Entries: ${entries || "none"}`);
  if (!options.write && options.fixture === null && !liveRunAllowsWrite(result)) {
    console.log("Write disabled: this live dry-run had a provider, model, or budget failure and did not pin an active batch.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error("Vocabulary verification failed.");
    process.exitCode = verificationExitCode(error);
  });
}
