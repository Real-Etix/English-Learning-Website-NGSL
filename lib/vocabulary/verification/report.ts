import { z } from "zod";

import { VerificationReasonCodeSchema } from "./types";

const count = z.number().int().nonnegative();
const cacheCount = z.object({ hits: count, misses: count }).strict();
const strictViolations = z.object({
  publishedPlaceholders: count,
  publishedUnsupportedSenses: count,
  claimableSensesWithoutSourcedExamples: count,
  publishedConnectionsToHiddenOrMissingTargets: count,
  learnerConnectionsWithoutGloss: count,
}).strict();
const reportEntry = z.object({
  lemma: z.string().min(1),
  reason: VerificationReasonCodeSchema,
}).strict();
const ChangedShardIdSchema = z.string().regex(/^[0-9a-f]{2}$/u);

const ReportShape = z.object({
  version: z.literal(1),
  mode: z.enum(["dry-run", "write"]),
  selected: count,
  attempted: count,
  sourceBacked: count,
  published: count,
  ambiguous: count,
  unsupported: count,
  failed: count,
  relationships: z.object({
    accepted: count,
    rejected: count,
    ambiguous: count,
    downgraded: count,
  }).strict(),
  cache: z.object({
    wordnet: cacheCount,
    dictionaryapi: cacheCount,
    tatoeba: cacheCount,
    llm: cacheCount,
  }).strict(),
  requests: z.object({ source: count, llm: count }).strict(),
  tokenUsage: z.object({ inputTokens: count, outputTokens: count }).strict(),
  changedShards: z.array(ChangedShardIdSchema),
  entries: z.array(reportEntry),
  remaining: z.object({
    hiddenAdvanced: count,
    strictViolations,
  }).strict(),
}).strict();

const FORBIDDEN_KEYS = new Set([
  "prompt",
  "response",
  "raw",
  "authorization",
  "apikey",
  "secret",
  "token",
]);

function scanForbiddenKeys(
  value: unknown,
  path: PropertyKey[],
  context: z.RefinementCtx,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenKeys(item, [...path, index], context));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLocaleLowerCase("en-US"))) {
      context.addIssue({
        code: "custom",
        message: `Sensitive report key is forbidden: ${key}`,
        path: [...path, key],
      });
    }
    scanForbiddenKeys(child, [...path, key], context);
  }
}

function sortedUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function normalizeChangedShards(values: readonly string[]): string[] {
  return sortedUniqueStrings(z.array(ChangedShardIdSchema).parse(values));
}

function entryKey(entry: { lemma: string; reason: string }): string {
  return JSON.stringify([entry.lemma, entry.reason]);
}

function sortedUniqueEntries<T extends { lemma: string; reason: string }>(values: readonly T[]): T[] {
  const byIdentity = new Map(values.map((entry) => [entryKey(entry), entry]));
  return [...byIdentity.values()].sort((left, right) =>
    left.lemma.localeCompare(right.lemma) || left.reason.localeCompare(right.reason));
}

const SanitizedReportInput = z.unknown().superRefine((value, context) => {
  scanForbiddenKeys(value, [], context);
});

export const VerificationReportSchema = SanitizedReportInput.pipe(ReportShape).superRefine((report, context) => {
  if (report.attempted > report.selected) {
    context.addIssue({ code: "custom", message: "attempted cannot exceed selected", path: ["attempted"] });
  }
  if (report.entries.length > report.selected) {
    context.addIssue({ code: "custom", message: "entries cannot exceed selected", path: ["entries"] });
  }
  if (report.published + report.ambiguous + report.unsupported + report.failed !== report.attempted) {
    context.addIssue({ code: "custom", message: "candidate result counts must sum to attempted" });
  }
  if (report.sourceBacked > report.attempted) {
    context.addIssue({ code: "custom", message: "sourceBacked cannot exceed attempted", path: ["sourceBacked"] });
  }
  if (JSON.stringify(report.changedShards) !== JSON.stringify(sortedUniqueStrings(report.changedShards))) {
    context.addIssue({ code: "custom", message: "changedShards must be sorted and unique", path: ["changedShards"] });
  }
  if (JSON.stringify(report.entries) !== JSON.stringify(sortedUniqueEntries(report.entries))) {
    context.addIssue({ code: "custom", message: "entries must be sorted and unique", path: ["entries"] });
  }
});

export type VerificationReport = z.infer<typeof VerificationReportSchema>;

/** Produces the stable, sanitized report representation used by CLI and fixtures. */
export function createVerificationReport(report: VerificationReport): VerificationReport {
  return VerificationReportSchema.parse({
    ...report,
    changedShards: normalizeChangedShards(report.changedShards),
    entries: sortedUniqueEntries(report.entries),
  });
}
