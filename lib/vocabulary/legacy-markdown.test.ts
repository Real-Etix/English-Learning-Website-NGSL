import { describe, expect, test } from "vitest";
import { parseLegacyMarkdownPage } from "./legacy-markdown";

describe("parseLegacyMarkdownPage", () => {
  test("parses only the migration-era markdown structure", () => {
    const page = parseLegacyMarkdownPage(`---
lemma: hand over
display: hand over
tier: advanced
pos: verb
forms: [hands over, handed over]
lists: []
sources: [llm]
status: enriched
---

## Definition
to give something to another person

## Examples
- Please hand over the keys. _(curated)_

## Connections
- builds_on: [[give]] — transfer possession
- domain: exchange

## Usage note
Often used when someone is required to give something.
`)!;

    expect(page).toMatchObject({
      lemma: "hand over",
      forms: ["hands over", "handed over"],
      definition: "to give something to another person",
      examples: ["Please hand over the keys."],
      connections: [{ type: "builds_on", target: "give", gloss: "transfer possession" }],
      domains: ["exchange"],
    });
  });

  test("rejects malformed markdown without frontmatter or a lemma", () => {
    expect(parseLegacyMarkdownPage("## Definition\nno frontmatter")).toBeNull();
    expect(parseLegacyMarkdownPage("---\ndisplay: no lemma\n---\n")).toBeNull();
  });
});
