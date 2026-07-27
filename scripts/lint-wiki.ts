/**
 * `lint` — health checks for the wiki against wiki/CLAUDE.md.
 *
 * Deterministic, offline, no LLM. This is the "manager loop" guardrail: it keeps
 * the compounding wiki consistent as pages are seeded, enriched, and ingested.
 *
 * Exits non-zero if there are errors (so it can gate CI / a pre-commit hook).
 * Usage: tsx scripts/lint-wiki.ts
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parsePage, type WikiPage } from "../lib/wiki/parse-wiki";
import type { ImportedCatalog } from "../lib/types";

const PAGES_DIR = path.join(process.cwd(), "wiki", "pages");
const CATALOG_PATH = path.join(process.cwd(), "data", "generated", "word-lists.json");

/** Every lemma that has a home in some list — a link to one of these is "not seeded yet", not dangling. */
async function loadCorpus(): Promise<Set<string>> {
  try {
    const catalog = JSON.parse(await readFile(CATALOG_PATH, "utf8")) as ImportedCatalog;
    return new Set(catalog.lists.flatMap((l) => l.words.map((w) => w.normalizedLemma)));
  } catch {
    return new Set();
  }
}

const ALLOWED_EDGES = new Set([
  "synonym",
  "antonym",
  "intensity",
  "builds_on",
  "advanced_form",
  "morphological",
  "collocation",
]);

const REQUIRED_SECTIONS = ["Definition", "Examples", "Connections"];

type Finding = { level: "error" | "warn"; page: string; message: string };

function fileToLemma(file: string) {
  return file.replace(/\.md$/, "");
}

async function main() {
  const files = (await readdir(PAGES_DIR).catch(() => [] as string[])).filter((f) =>
    f.endsWith(".md"),
  );

  const corpus = await loadCorpus();
  const findings: Finding[] = [];
  const pages = new Map<string, WikiPage>();
  const raw = new Map<string, string>();

  // Load + structural checks.
  for (const file of files) {
    const lemma = fileToLemma(file);
    const text = await readFile(path.join(PAGES_DIR, file), "utf8");
    raw.set(lemma, text);

    const page = parsePage(text);
    if (!page) {
      findings.push({ level: "error", page: lemma, message: "no valid frontmatter" });
      continue;
    }
    if (page.lemma !== lemma) {
      findings.push({
        level: "error",
        page: lemma,
        message: `frontmatter lemma "${page.lemma}" != filename "${lemma}"`,
      });
    }
    for (const field of ["display", "pos"] as const) {
      if (!page[field]) {
        findings.push({ level: "error", page: lemma, message: `missing frontmatter: ${field}` });
      }
    }
    for (const section of REQUIRED_SECTIONS) {
      if (!new RegExp(`##\\s+${section}\\b`).test(text)) {
        findings.push({ level: "error", page: lemma, message: `missing section: ## ${section}` });
      }
    }
    if (!page.definition) {
      findings.push({ level: "error", page: lemma, message: "empty definition" });
    }
    pages.set(lemma, page);
  }

  // Relational checks.
  const inbound = new Map<string, number>();
  const hasEdge = (from: string, type: string, to: string) =>
    pages.get(from)?.connections.some((c) => c.type === type && c.target === to) ?? false;

  for (const [lemma, page] of pages) {
    for (const conn of page.connections) {
      if (!ALLOWED_EDGES.has(conn.type)) {
        findings.push({
          level: "error",
          page: lemma,
          message: `unknown edge type "${conn.type}" → ${conn.target}`,
        });
        continue;
      }
      if (!pages.has(conn.target)) {
        // In-corpus target = page just isn't seeded yet (pending); otherwise dangling.
        findings.push(
          corpus.has(conn.target)
            ? {
                level: "warn",
                page: lemma,
                message: `${conn.type} → [[${conn.target}]] not seeded yet (in corpus)`,
              }
            : {
                level: "error",
                page: lemma,
                message: `${conn.type} dangling link to unknown word [[${conn.target}]]`,
              },
        );
        continue;
      }
      inbound.set(conn.target, (inbound.get(conn.target) ?? 0) + 1);

      // reciprocity: builds_on (adv→core) ⇔ advanced_form (core→adv)
      if (conn.type === "builds_on" && !hasEdge(conn.target, "advanced_form", lemma)) {
        findings.push({
          level: "error",
          page: lemma,
          message: `builds_on [[${conn.target}]] has no reciprocal advanced_form back to "${lemma}"`,
        });
      }
      if (conn.type === "advanced_form" && !hasEdge(conn.target, "builds_on", lemma)) {
        findings.push({
          level: "error",
          page: lemma,
          message: `advanced_form [[${conn.target}]] has no reciprocal builds_on back to "${lemma}"`,
        });
      }
    }

    // anchor rule: every advanced page must build on a core word.
    if (page.tier === "advanced") {
      const anchors = page.connections.filter((c) => c.type === "builds_on");
      if (anchors.length === 0) {
        findings.push({
          level: "error",
          page: lemma,
          message: "advanced page has no builds_on anchor to a core word",
        });
      } else if (!anchors.some((a) => pages.get(a.target)?.tier === "core")) {
        findings.push({
          level: "error",
          page: lemma,
          message: "builds_on target is not a core word",
        });
      }
    }
  }

  // Warnings.
  for (const [lemma, page] of pages) {
    if (page.tier === "core" && page.connections.length === 0) {
      findings.push({ level: "warn", page: lemma, message: "core page has zero connections" });
    }
    if ((inbound.get(lemma) ?? 0) === 0 && page.connections.length === 0) {
      findings.push({ level: "warn", page: lemma, message: "orphan page (no links in or out)" });
    }
  }

  // Report.
  const errors = findings.filter((f) => f.level === "error");
  const warns = findings.filter((f) => f.level === "warn");
  const byLevel = (level: "error" | "warn", color: string) =>
    findings
      .filter((f) => f.level === level)
      .forEach((f) => console.log(`  ${color}${level.toUpperCase()}\x1b[0m ${f.page}: ${f.message}`));

  console.log(`\nLinted ${pages.size} page(s).`);
  byLevel("error", "\x1b[31m");
  byLevel("warn", "\x1b[33m");
  console.log(`\n${errors.length} error(s), ${warns.length} warning(s).`);

  if (errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
