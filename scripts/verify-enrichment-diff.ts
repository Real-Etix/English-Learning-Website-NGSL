import nodePath from "node:path";
import { readFile } from "node:fs/promises";

export type EnrichmentDiffResult = {
  allowed: boolean;
  errors: string[];
};

export type EnrichmentReport = {
  stage: string;
  factualImports: number;
  reviewProposals: number;
  hiddenRecords: number;
  rejections: number;
  unknownTargets: number;
  tokenUsage: { inputTokens: number; outputTokens: number };
  estimatedRemainingDebt: number;
};

type ChangedPath = {
  path: string;
  status: string;
};

const VALID_STATUSES = new Set(["A", "M", "D"]);
const SHARD_ID = "(?:0[0-9a-f]|1[0-9a-f])";
const LIST_ID = "(?:academic|all|business|fitness|ngsl|toeic)";

const PROTECTED_CANONICAL_FILES = new Set([
  "content/vocabulary/schema.json",
  "content/vocabulary/sources.json",
  "content/vocabulary/manifest.json",
]);

const ALLOWED_PATH_PATTERNS = [
  new RegExp(`^content/vocabulary/${SHARD_ID}\\.ndjson$`),
  /^content\/vocabulary\/manifest\.json$/,
  new RegExp(`^data/generated/graphs/${LIST_ID}\\.json$`),
  new RegExp(`^data/generated/vocabulary/(?:manifest\\.json|words-${SHARD_ID}\\.json)$`),
  new RegExp(`^public/generated/galaxy/manifests/${LIST_ID}\\.json$`),
  new RegExp(`^public/generated/galaxy/assets/${LIST_ID}-(?:chart|search)-[0-9a-f]{12}\\.json$`),
  new RegExp(`^public/generated/galaxy/assets/${LIST_ID}-full-[0-9a-f]{12}\\.bin$`),
];

function parseChangedPath(value: string): ChangedPath | string {
  const match = /^([AMD])\t([^\t]+)$/.exec(value);
  if (!match || !VALID_STATUSES.has(match[1])) return `malformed diff entry: ${JSON.stringify(value)}`;
  return { status: match[1], path: match[2] };
}

function isRepositoryRelativePath(filePath: string): boolean {
  return (
    filePath.length > 0 &&
    !filePath.startsWith("/") &&
    !/^[A-Za-z]:[\\/]/.test(filePath) &&
    !filePath.includes("\\") &&
    !filePath.split("/").some((segment) => segment === "." || segment === "..")
  );
}

function isAllowedPath(filePath: string): boolean {
  return ALLOWED_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

const REPORT_FIELDS = new Set([
  "stage",
  "factualImports",
  "reviewProposals",
  "hiddenRecords",
  "rejections",
  "unknownTargets",
  "tokenUsage",
  "estimatedRemainingDebt",
]);
const TOKEN_USAGE_FIELDS = new Set(["inputTokens", "outputTokens"]);
const SENSITIVE_REPORT_FIELD = /(?:api[_-]?key|authorization|prompt|response|completion|message|secret|token(?!usage))/i;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && Number.isFinite(value);
}

/** Ensures the workflow artifact contains aggregate audit data, never provider material. */
export function verifyEnrichmentReport(value: string): EnrichmentDiffResult {
  let report: unknown;
  try {
    report = JSON.parse(value);
  } catch {
    return { allowed: false, errors: ["invalid enrichment report JSON"] };
  }
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return { allowed: false, errors: ["enrichment report must be an object"] };
  }
  const entries = Object.entries(report as Record<string, unknown>);
  const errors: string[] = [];
  for (const [key] of entries) {
    if (SENSITIVE_REPORT_FIELD.test(key)) errors.push(`sensitive report field: ${key}`);
    else if (!REPORT_FIELDS.has(key)) errors.push(`unexpected report field: ${key}`);
  }
  const candidate = report as Partial<EnrichmentReport>;
  if (typeof candidate.stage !== "string" || !candidate.stage.trim()) errors.push("report stage must be non-blank");
  for (const field of ["factualImports", "reviewProposals", "hiddenRecords", "rejections", "unknownTargets", "estimatedRemainingDebt"] as const) {
    if (!isCount(candidate[field])) errors.push(`report ${field} must be a non-negative integer`);
  }
  if (!candidate.tokenUsage || typeof candidate.tokenUsage !== "object" || Array.isArray(candidate.tokenUsage)) {
    errors.push("report tokenUsage must be an object");
  } else {
    for (const [key, tokenValue] of Object.entries(candidate.tokenUsage)) {
      if (!TOKEN_USAGE_FIELDS.has(key)) errors.push(`unexpected tokenUsage field: ${key}`);
      else if (!isCount(tokenValue)) errors.push(`report tokenUsage.${key} must be a non-negative integer`);
    }
    for (const key of TOKEN_USAGE_FIELDS) {
      if (!(key in candidate.tokenUsage)) errors.push(`report tokenUsage.${key} is required`);
    }
  }
  return { allowed: errors.length === 0, errors };
}

/** Validates newline-delimited `git diff --name-status` entries without touching the filesystem. */
export function verifyEnrichmentPaths(paths: readonly string[]): EnrichmentDiffResult {
  const errors: string[] = [];

  for (const value of paths) {
    const parsed = parseChangedPath(value);
    if (typeof parsed === "string") {
      errors.push(parsed);
      continue;
    }
    const { status, path: filePath } = parsed;
    if (status === "D" && PROTECTED_CANONICAL_FILES.has(filePath)) {
      errors.push(`protected file cannot be deleted: ${filePath}`);
      continue;
    }
    if (!isRepositoryRelativePath(filePath)) {
      errors.push(`path must be repository-relative: ${filePath}`);
      continue;
    }
    if (!isAllowedPath(filePath)) errors.push(`disallowed path: ${filePath}`);
  }

  return { allowed: errors.length === 0, errors };
}

async function readStdin(): Promise<string> {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main(): Promise<void> {
  const reportArgument = process.argv.slice(2).find((argument) => argument.startsWith("--report="));
  if (reportArgument) {
    const report = await readFile(reportArgument.slice("--report=".length), "utf8");
    const result = verifyEnrichmentReport(report);
    if (!result.allowed) {
      for (const error of result.errors) console.error(error);
      process.exitCode = 1;
      return;
    }
    console.log("Validated enrichment report.");
    return;
  }
  const input = await readStdin();
  const paths = input.split(/\r?\n/).filter((line) => line.length > 0);
  const result = verifyEnrichmentPaths(paths);
  if (!result.allowed) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${paths.length} enrichment change(s).`);
}

if (process.argv[1] && nodePath.resolve(process.argv[1]) === nodePath.join(process.cwd(), "scripts", "verify-enrichment-diff.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
