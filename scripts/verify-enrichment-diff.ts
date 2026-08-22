import nodePath from "node:path";

export type EnrichmentDiffResult = {
  allowed: boolean;
  errors: string[];
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
