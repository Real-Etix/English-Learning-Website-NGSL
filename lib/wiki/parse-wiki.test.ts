import { describe, expect, it } from "vitest";

import { parsePage } from "./parse-wiki";

const page = (frontmatter: string, body: string) =>
  parsePage(`---\n${frontmatter}\n---\n\n${body}`)!;

describe("parsePage", () => {
  const p = page(
    "lemma: big\ndisplay: big\ntier: core\npos: adjective\nforms: [big, bigger]\nlists: [ngsl]\nrank: 184\nsfi: 67.22\nstatus: enriched\nsources: [wordnet, llm]",
    "## Definition\nabove average in size\n\n## Examples\n- a big house _(wordnet)_\n\n## Connections\n- synonym: [[large]]\n- advanced_form: [[enormous]] — reach higher\n- domain: size\n\n## Usage note\nUsually used before a concrete noun.\n",
  );

  it("parses frontmatter fields", () => {
    expect(p.lemma).toBe("big");
    expect(p.tier).toBe("core");
    expect(p.pos).toBe("adjective");
    expect(p.forms).toEqual(["big", "bigger"]);
    expect(p.lists).toEqual(["ngsl"]);
    expect(p.rank).toBe(184);
    expect(p.sfi).toBe(67.22);
    expect(p.sources).toEqual(["wordnet", "llm"]);
    expect(p.usageNote).toBe("Usually used before a concrete noun.");
  });

  it("parses the definition and strips the example's source tag", () => {
    expect(p.definition).toBe("above average in size");
    expect(p.examples).toEqual(["a big house"]);
  });

  it("parses typed connections, glosses, and domains", () => {
    expect(p.connections).toContainEqual({ type: "synonym", target: "large", gloss: undefined });
    expect(p.connections).toContainEqual({ type: "advanced_form", target: "enormous", gloss: "reach higher" });
    expect(p.domains).toEqual(["size"]);
  });

  it("returns null when there is no frontmatter", () => {
    expect(parsePage("just some text")).toBeNull();
  });
});
