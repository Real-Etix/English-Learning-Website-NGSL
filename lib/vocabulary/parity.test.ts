import { describe, expect, test } from "vitest";

import type { WikiPage } from "./legacy-markdown";
import { compareLegacyAndCanonical } from "./parity";
import type { VocabularyRecord } from "./schema";
import { vocabularyRecordFixture } from "./test-fixtures";

const source = vocabularyRecordFixture().sources[0]!;

function legacyPage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    lemma: "bank",
    display: "Bank",
    tier: "core",
    pos: "noun",
    rank: 1,
    sfi: 60,
    chart: "money",
    region: "finance",
    lists: ["business", "ngsl"],
    forms: ["bank", "banks"],
    status: "enriched",
    sources: ["wordnet"],
    definition: "old",
    usageNote: "Use this sense for money.",
    examples: [{ text: "The bank is open.", sourceIds: ["tatoeba"] }],
    connections: [{ type: "collocation", target: "money", gloss: "money at a bank" }],
    domains: ["finance"],
    ...overrides,
  };
}

function canonicalRecord(overrides: Partial<VocabularyRecord> = {}): VocabularyRecord {
  return {
    ...vocabularyRecordFixture(),
    lemma: "bank",
    display: "Bank",
    tier: "core",
    partOfSpeech: "noun",
    forms: ["bank", "banks"],
    lists: [
      { id: "business", rank: 1, sfi: 60 },
      { id: "ngsl", rank: 1, sfi: 60 },
    ],
    status: "enriched",
    sources: [source],
    senses: [{
      ...vocabularyRecordFixture().senses[0]!,
      id: "bank-noun-1",
      partOfSpeech: "noun",
      definition: "old",
      sources: [source],
      examples: [{ text: "The bank is open.", sources: [{ ...source, sourceId: "tatoeba" }] }],
    }],
    usageNote: "Use this sense for money.",
    connections: [{
      target: "money",
      type: "collocation",
      gloss: "money at a bank",
      sources: [source],
      status: "published",
    }],
    domains: ["finance"],
    chart: "money",
    region: "finance",
    ...overrides,
  };
}

describe("compareLegacyAndCanonical", () => {
  test("reports complete parity for matching one-word fixtures", () => {
    const report = compareLegacyAndCanonical([legacyPage()], [canonicalRecord()]);

    expect(report.ok).toBe(true);
    expect(report.mismatches).toEqual([]);
    expect(Object.keys(report.graphs)).toEqual(["academic", "all", "business", "fitness", "ngsl", "toeic"]);
  });

  test("reports the exact authored definition field", () => {
    const report = compareLegacyAndCanonical([legacyPage()], [canonicalRecord({
      senses: [{ ...canonicalRecord().senses[0]!, definition: "changed" }],
    })]);

    expect(report.mismatches).toContainEqual({
      lemma: "bank", field: "senses[0].definition", legacy: "old", canonical: "changed",
    });
  });

  test("reports a missing example at its exact field path", () => {
    const report = compareLegacyAndCanonical([legacyPage()], [canonicalRecord({
      senses: [{ ...canonicalRecord().senses[0]!, examples: [] }],
    })]);

    expect(report.mismatches).toContainEqual({
      lemma: "bank", field: "senses[0].examples[0]", legacy: { text: "The bank is open.", sources: ["tatoeba"] }, canonical: undefined,
    });
  });

  test("reports an altered connection gloss at its exact field path", () => {
    const report = compareLegacyAndCanonical([legacyPage()], [canonicalRecord({
      connections: [{ ...canonicalRecord().connections[0]!, gloss: "changed" }],
    })]);

    expect(report.mismatches).toContainEqual({
      lemma: "bank", field: "connections[0].gloss", legacy: "money at a bank", canonical: "changed",
    });
  });

  test("reports a missing list membership at its exact field path", () => {
    const report = compareLegacyAndCanonical([legacyPage()], [canonicalRecord({
      lists: [{ id: "business", rank: 1, sfi: 60 }],
    })]);

    expect(report.mismatches).toContainEqual({
      lemma: "bank", field: "lists[1]", legacy: { id: "ngsl", rank: 1, sfi: 60 }, canonical: undefined,
    });
  });

  test("reports graph node, edge, rank, display, and calculated chart changes", () => {
    const lemmas = ["account", "bank", "deposit", "loan", "money"];
    const pages = lemmas.map((lemma, index) => legacyPage({
      lemma,
      display: lemma,
      rank: (index + 1) * 10,
      lists: ["ngsl"],
      forms: [lemma],
      definition: `${lemma} definition`,
      connections: lemmas.filter((target) => target !== lemma).map((target) => ({
        type: "collocation", target, gloss: `${lemma} with ${target}`,
      })),
    }));
    const records = pages.map((page) => canonicalRecord({
      lemma: page.lemma,
      display: page.display,
      forms: page.forms,
      lists: [{ id: "ngsl", rank: page.rank, sfi: page.sfi }],
      senses: [{ ...canonicalRecord().senses[0]!, definition: page.definition }],
      connections: page.connections.map((connection) => ({
        target: connection.target,
        type: "collocation",
        gloss: connection.gloss!,
        sources: [source],
        status: "published",
      })),
    }));
    const changed = records
      .filter((record) => record.lemma !== "money")
      .map((record) => record.lemma === "account" ? {
        ...record,
        display: "Account",
        lists: [{ id: "ngsl", rank: 1, sfi: 60 }],
        connections: record.connections.filter((connection) => connection.target !== "bank"),
      } : record);

    const report = compareLegacyAndCanonical(pages, changed);
    const graphMismatches = report.graphs.ngsl.mismatches.map((mismatch) => mismatch.field);

    expect(graphMismatches.some((field) => field.startsWith("nodes") && field.endsWith(".display"))).toBe(true);
    expect(graphMismatches.some((field) => field.startsWith("nodes") && field.endsWith(".rank"))).toBe(true);
    expect(graphMismatches.some((field) => field.startsWith("nodes") && field.endsWith(".chart"))).toBe(true);
    expect(graphMismatches.some((field) => field.startsWith("nodes"))).toBe(true);
    expect(graphMismatches.some((field) => field.startsWith("edges"))).toBe(true);
  });

  test("treats equivalent graph insertion order and edge direction as equal", () => {
    const pages = ["account", "bank", "deposit", "loan", "money"].map((lemma, index) => legacyPage({
      lemma,
      display: lemma,
      rank: index + 1,
      lists: ["ngsl"],
      forms: [lemma],
      definition: `${lemma} definition`,
      connections: [
        { type: "collocation", target: index === 4 ? "account" : ["account", "bank", "deposit", "loan", "money"][index + 1]!, gloss: "linked" },
        { type: "collocation", target: index === 0 ? "money" : ["account", "bank", "deposit", "loan", "money"][index - 1]!, gloss: "linked" },
      ],
    }));
    const records = pages.map((page) => canonicalRecord({
      lemma: page.lemma,
      display: page.display,
      forms: page.forms,
      lists: [{ id: "ngsl", rank: page.rank, sfi: page.sfi }],
      senses: [{ ...canonicalRecord().senses[0]!, definition: page.definition }],
      connections: page.connections.map((connection) => ({
        target: connection.target,
        type: "collocation",
        gloss: connection.gloss!,
        sources: [source],
        status: "published",
      })),
    })).reverse();

    expect(compareLegacyAndCanonical(pages, records).ok).toBe(true);
  });
});
