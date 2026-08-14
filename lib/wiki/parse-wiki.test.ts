import { describe, expect, it } from "vitest";

import { buildCollectionGraph, buildListGraph, parsePage, toLiteGraph } from "./parse-wiki";

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

describe("buildListGraph", () => {
  const big = page("lemma: big\ntier: core\nlists: [ngsl]\nrank: 184", "## Connections\n- synonym: [[large]]\n- advanced_form: [[enormous]]\n");
  const large = page("lemma: large\ntier: core\nlists: [ngsl]\nrank: 210", "## Connections\n- synonym: [[big]]\n");
  const enormous = page("lemma: enormous\ntier: advanced", "## Connections\n- builds_on: [[big]]\n");
  const zebra = page("lemma: zebra\ntier: core\nlists: [ngsl]", "## Connections\n");
  const pages = [big, large, enormous, zebra];

  it("pulls in advanced words linked from list words", () => {
    const g = buildListGraph(pages, "ngsl");
    expect(g.nodes.map((n) => n.lemma).sort()).toEqual(["big", "enormous", "large", "zebra"]);
  });

  it("keeps unconnected words but counts them isolated", () => {
    const g = buildListGraph(pages, "ngsl");
    expect(g.nodes.find((n) => n.lemma === "zebra")?.degree).toBe(0);
    expect(g.isolatedCount).toBe(1);
  });

  it("dedupes edges by unordered pair + type, both ends in-graph", () => {
    const g = buildListGraph(pages, "ngsl");
    // big–large synonym (deduped to 1) + big–enormous advanced_form + big–enormous builds_on
    expect(g.edges).toHaveLength(3);
    const ids = new Set(g.nodes.map((n) => n.lemma));
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it("buildCollectionGraph keeps only the owned lemmas and their internal edges", () => {
    const g = buildCollectionGraph(pages, new Set(["big", "large"]));
    expect(g.nodes.map((n) => n.lemma).sort()).toEqual(["big", "large"]);
    expect(g.edges).toHaveLength(1); // just the big–large synonym
  });

  it("toLiteGraph drops the heavy pages map", () => {
    const lite = toLiteGraph(buildListGraph(pages, "ngsl"));
    expect(lite).not.toHaveProperty("pages");
    expect(lite.nodes.length).toBeGreaterThan(0);
    expect(lite.edges.length).toBeGreaterThan(0);
  });
});
