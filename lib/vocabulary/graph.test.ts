import { describe, expect, it } from "vitest";

import { buildCollectionGraph, buildListGraph, toLiteGraph } from "./graph";
import { toGraphInput } from "./graph-input";
import { vocabularyRecordFixture } from "./test-fixtures";

const record = (overrides: Partial<ReturnType<typeof vocabularyRecordFixture>>) => ({
  ...vocabularyRecordFixture(),
  ...overrides,
});

describe("buildListGraph", () => {
  const big = record({
    lemma: "big",
    display: "big",
    tier: "core",
    partOfSpeech: "adjective",
    lists: [{ id: "ngsl", rank: 184, sfi: 67.22 }],
    connections: [
      { ...vocabularyRecordFixture().connections[0]!, target: "large", type: "synonym" },
      { ...vocabularyRecordFixture().connections[0]!, target: "enormous", type: "advanced_form" },
      { ...vocabularyRecordFixture().connections[0]!, target: "bridge", type: "collocation" },
    ],
  });
  const large = record({
    lemma: "large",
    display: "large",
    tier: "core",
    partOfSpeech: "adjective",
    lists: [{ id: "ngsl", rank: 210, sfi: 66 }],
    connections: [{ ...vocabularyRecordFixture().connections[0]!, target: "big", type: "synonym" }],
  });
  const enormous = record({
    lemma: "enormous",
    display: "enormous",
    tier: "advanced",
    lists: [],
    connections: [{ ...vocabularyRecordFixture().connections[0]!, target: "big", type: "builds_on" }],
  });
  const zebra = record({
    lemma: "zebra",
    display: "zebra",
    lists: [{ id: "ngsl", rank: 500, sfi: 50 }],
    connections: [],
  });
  const bridge = record({
    lemma: "bridge",
    display: "bridge",
    lists: [{ id: "academic", rank: 5, sfi: 55 }],
    connections: [],
  });
  const other = record({
    lemma: "other",
    display: "other",
    lists: [{ id: "ngsl", rank: 220, sfi: 65 }],
    connections: [{ ...vocabularyRecordFixture().connections[0]!, target: "bridge", type: "collocation" }],
  });
  const records = [big, large, enormous, zebra, bridge, other];
  const inputs = records.map((entry) => toGraphInput(entry, { records }));

  it("keeps list words, pulls advanced targets, and adds bridges linked by two list words", () => {
    const graph = buildListGraph(inputs, "ngsl");

    expect(graph.nodes.map((node) => node.lemma).sort()).toEqual([
      "big", "bridge", "enormous", "large", "other", "zebra",
    ]);
  });

  it("keeps isolated words as drift stars and counts them", () => {
    const graph = buildListGraph(inputs, "ngsl");
    const node = graph.nodes.find((candidate) => candidate.lemma === "zebra");

    expect(node).toMatchObject({ degree: 0, chart: "drift" });
    expect(graph.isolatedCount).toBe(1);
  });

  it("deduplicates unordered typed edges and keeps both endpoints in the graph", () => {
    const graph = buildListGraph(inputs, "ngsl");
    const nodes = new Set(graph.nodes.map((node) => node.lemma));

    expect(graph.edges).toHaveLength(5);
    for (const edge of graph.edges) {
      expect(nodes.has(edge.source)).toBe(true);
      expect(nodes.has(edge.target)).toBe(true);
    }
  });

  it("assigns stable Louvain charts from the canonical connections", () => {
    const first = buildListGraph(inputs, "ngsl");
    const second = buildListGraph([...inputs].reverse(), "ngsl");

    expect(second.nodes.map(({ lemma, chart }) => ({ lemma, chart })).sort((a, b) => a.lemma.localeCompare(b.lemma)))
      .toEqual(first.nodes.map(({ lemma, chart }) => ({ lemma, chart })).sort((a, b) => a.lemma.localeCompare(b.lemma)));
  });

  it("uses the legacy Markdown filename order for hyphenated lemmas", () => {
    const orderedRecords = ["also", "also-ran"].map((lemma) => record({
      lemma,
      display: lemma,
      lists: [{ id: "ngsl", rank: 1, sfi: 60 }],
      connections: [],
    }));
    const ordered = orderedRecords.map((entry) => toGraphInput(entry, { records: orderedRecords }));

    expect(buildListGraph(ordered, "ngsl").nodes.map((node) => node.lemma)).toEqual(["also-ran", "also"]);
  });

  it("preserves the legacy lexical hub order when degree and rank tie", () => {
    const tiedRecords = ["a", "b", "c", "z", "ä"].map((lemma) => record({
      lemma,
      display: lemma,
      lists: [{ id: "ngsl", rank: 1, sfi: 60 }],
      connections: [],
    }));
    const tied = tiedRecords.map((entry) => toGraphInput(entry, { records: tiedRecords }));
    const byLemma = new Map(tied.map((input) => [input.lemma, input]));
    byLemma.get("a")!.connections = [
      { target: "z", type: "synonym" },
      { target: "ä", type: "synonym" },
    ];
    byLemma.get("b")!.connections = [{ target: "z", type: "synonym" }];
    byLemma.get("c")!.connections = [{ target: "ä", type: "synonym" }];
    byLemma.get("z")!.connections = [{ target: "ä", type: "synonym" }];

    const graph = buildListGraph(tied, "ngsl");

    expect(graph.nodes.map(({ lemma, chart }) => ({ lemma, chart }))).toEqual([
      { lemma: "a", chart: "z" },
      { lemma: "b", chart: "z" },
      { lemma: "c", chart: "z" },
      { lemma: "z", chart: "z" },
      { lemma: "ä", chart: "z" },
    ]);
  });

  it("builds a collection graph only from the owned canonical records", () => {
    const graph = buildCollectionGraph(inputs, new Set(["big", "large"]));

    expect(graph.nodes.map((node) => node.lemma).sort()).toEqual(["big", "large"]);
    expect(graph.edges).toHaveLength(1);
  });

  it("returns a lightweight graph without canonical page payloads", () => {
    const graph = toLiteGraph(buildListGraph(inputs, "ngsl"));

    expect(graph).not.toHaveProperty("pages");
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
  });
});
