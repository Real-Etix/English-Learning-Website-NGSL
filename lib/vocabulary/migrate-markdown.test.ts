import { describe, expect, test } from "vitest";
import { convertLegacyMarkdown } from "./migrate-markdown";

const markdown = `---
lemma: bank
display: Bank
tier: core
pos: noun
forms: [banks, bank]
lists: [ngsl, business, ngsl]
rank: 627
sfi: 61.85
sources: [wordnet, dictionaryapi]
status: enriched
chart: money
region: finance
---

## Definition
A place that keeps and lends money.

## Examples
- She deposited the cheque at the bank. _(dictionaryapi)_
- The bank opens at nine. _(wordnet)_

## Connections
- collocation: [[deposit]] — money is deposited at a bank
- synonym: [[financial institution]]
- domain: finance

## Usage note
Use the financial sense when discussing accounts, loans, or deposits.
`;

describe("convertLegacyMarkdown", () => {
  test("preserves authored content, source suffixes, and deterministic metadata", () => {
    const record = convertLegacyMarkdown(markdown)!;

    expect(record.senses[0].definition).toBe("A place that keeps and lends money.");
    expect(record.senses[0].examples).toEqual([
      expect.objectContaining({ text: "She deposited the cheque at the bank." }),
      expect.objectContaining({ text: "The bank opens at nine." }),
    ]);
    expect(record.senses[0].examples[0].sources).toEqual([
      expect.objectContaining({ sourceId: "dictionaryapi" }),
    ]);
    expect(record.connections[0]).toMatchObject({
      target: "deposit", type: "collocation", gloss: "money is deposited at a bank", status: "published",
    });
    expect(record.connections[1]).toMatchObject({
      target: "financial institution", type: "synonym", gloss: null, status: "unreviewed",
    });
    expect(record.lists.map((entry) => entry.id)).toEqual(["business", "ngsl"]);
    expect(record.lists).toEqual([
      { id: "business", rank: 627, sfi: 61.85 },
      { id: "ngsl", rank: 627, sfi: 61.85 },
    ]);
    expect(record.usageNote).toBe("Use the financial sense when discussing accounts, loans, or deposits.");
    expect(record.domains).toEqual(["finance"]);
    expect(record.senses[0].usagePatterns).toEqual([]);
    expect(record.senses[0].collocations).toEqual([]);
    expect(record.senses[0].commonMistakes).toEqual([]);
    expect(convertLegacyMarkdown(markdown)?.senses[0].id).toBe(record.senses[0].id);
  });

  test("returns null for empty or structurally malformed pages", () => {
    expect(convertLegacyMarkdown("")).toBeNull();
    expect(convertLegacyMarkdown("## Definition\nMissing frontmatter")).toBeNull();
  });
});
