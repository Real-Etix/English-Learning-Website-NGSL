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
      examples: [{ text: "Please hand over the keys.", sourceIds: ["curated"] }],
      connections: [{ type: "builds_on", target: "give", gloss: "transfer possession" }],
      domains: ["exchange"],
    });
  });

  test("rejects malformed markdown without frontmatter or a lemma", () => {
    expect(parseLegacyMarkdownPage("## Definition\nno frontmatter")).toBeNull();
    expect(parseLegacyMarkdownPage("---\ndisplay: no lemma\n---\n")).toBeNull();
  });

  test("preserves authored spacing while removing Markdown structure", () => {
    const definition = "  Intentional  definition spacing.  ";
    const example = "-  Keep  the example margin  _(curated)_";
    const connection = "- collocation: [[space]] —  keep  every  gloss gap  ";
    const page = parseLegacyMarkdownPage(`---
lemma: spacing
display: spacing
tier: core
pos: noun
sources: [curated]
---

## Definition
${definition}

## Examples
${example}

## Connections
${connection}
`)!;

    expect(page.definition).toBe("  Intentional  definition spacing.  ");
    expect(page.examples).toEqual([{ text: " Keep  the example margin ", sourceIds: ["curated"] }]);
    expect(page.connections).toEqual([
      { type: "collocation", target: "space", gloss: " keep  every  gloss gap  " },
    ]);
  });
});
