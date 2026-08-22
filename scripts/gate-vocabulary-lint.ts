import { readFile } from "node:fs/promises";

import type { Finding, VocabularyLintReport } from "./lint-vocabulary";

function isFinding(value: unknown): value is Finding {
  return typeof value === "object" && value !== null
    && "level" in value && (value.level === "error" || value.level === "warn")
    && "lemma" in value && typeof value.lemma === "string"
    && "message" in value && typeof value.message === "string";
}

/** Parses only the machine-readable report emitted by lint-vocabulary --json. */
export function parseVocabularyLintReport(value: unknown): VocabularyLintReport {
  if (typeof value !== "object" || value === null
    || !("version" in value) || value.version !== 1
    || !("records" in value) || typeof value.records !== "number" || !Number.isInteger(value.records) || value.records < 0
    || !("findings" in value) || !Array.isArray(value.findings) || !value.findings.every(isFinding)) {
    throw new Error("Vocabulary lint report is malformed.");
  }
  return { version: 1, records: value.records, findings: value.findings };
}

function errorIdentity(finding: Finding): string {
  return `error:${JSON.stringify([finding.lemma, finding.message])}`;
}

/** Returns newly introduced error identities while allowing inherited findings to remain or decrease. */
export function compareVocabularyLintReports(current: VocabularyLintReport, base: VocabularyLintReport): string[] {
  const baseErrors = new Set(base.findings.filter((finding) => finding.level === "error").map(errorIdentity));
  return [...new Set(current.findings.filter((finding) => finding.level === "error").map(errorIdentity))]
    .filter((identity) => !baseErrors.has(identity))
    .sort();
}

/** Ensures a captured report was produced by a complete lint run, not a malformed or crashed command. */
export function validateVocabularyLintExit(report: VocabularyLintReport, exitCode: number): void {
  const expectedExitCode = report.findings.some((finding) => finding.level === "error") ? 1 : 0;
  if (exitCode !== expectedExitCode) {
    throw new Error("Vocabulary lint command crashed or reported inconsistent output.");
  }
}

function argumentValue(name: string): string | null {
  const argument = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  return argument ? argument.slice(name.length + 3) : null;
}

function exitCodeArgument(name: string): number {
  const value = argumentValue(name);
  const parsed = value === null ? Number.NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative integer.`);
  return parsed;
}

async function readReport(filePath: string): Promise<VocabularyLintReport> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Vocabulary lint report could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseVocabularyLintReport(value);
}

async function main(): Promise<void> {
  const validatePath = argumentValue("validate");
  const basePath = argumentValue("base");
  const currentPath = argumentValue("current");
  if (validatePath) {
    if (basePath || currentPath) throw new Error("--validate cannot be combined with --base or --current.");
    validateVocabularyLintExit(await readReport(validatePath), exitCodeArgument("exit-code"));
    return;
  }
  if (!basePath || !currentPath) throw new Error("--base and --current are required.");
  const base = await readReport(basePath);
  const current = await readReport(currentPath);
  validateVocabularyLintExit(base, exitCodeArgument("base-exit-code"));
  validateVocabularyLintExit(current, exitCodeArgument("current-exit-code"));
  const regressions = compareVocabularyLintReports(current, base);
  if (regressions.length > 0) {
    console.error(`Vocabulary lint regression: ${regressions.join("; ")}.`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("gate-vocabulary-lint.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
