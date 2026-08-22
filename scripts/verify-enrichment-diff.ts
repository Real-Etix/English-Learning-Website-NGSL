import path from "node:path";

export type EnrichmentDiffResult = {
  allowed: boolean;
  errors: string[];
};

type ChangedPath = {
  path: string;
  status: string;
};

const PROTECTED_CANONICAL_FILES = new Set([
  "content/vocabulary/schema.json",
  "content/vocabulary/sources.json",
  "content/vocabulary/manifest.json",
]);

function parseChangedPath(value: string): ChangedPath {
  const [status, ...pathParts] = value.split("\t");
  if (pathParts.length === 0) return { status: "M", path: status };
  return { status, path: pathParts.join("\t") };
}

function isAllowedPath(filePath: string): boolean {
  return (
    /^content\/vocabulary\/[^/]+\.ndjson$/.test(filePath) ||
    filePath === "content/vocabulary/manifest.json" ||
    filePath.startsWith("data/generated/graphs/") ||
    filePath.startsWith("data/generated/vocabulary/") ||
    filePath.startsWith("public/generated/galaxy/")
  );
}

/** Validates newline-delimited `git diff --name-status` entries without touching the filesystem. */
export function verifyEnrichmentPaths(paths: readonly string[]): EnrichmentDiffResult {
  const errors: string[] = [];

  for (const value of paths) {
    const { status, path: filePath } = parseChangedPath(value);
    if (status === "D" && PROTECTED_CANONICAL_FILES.has(filePath)) {
      errors.push(`protected file cannot be deleted: ${filePath}`);
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
  const paths = input.split("\n").filter(Boolean);
  const result = verifyEnrichmentPaths(paths);
  if (!result.allowed) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${paths.length} enrichment change(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(process.cwd(), "scripts", "verify-enrichment-diff.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
