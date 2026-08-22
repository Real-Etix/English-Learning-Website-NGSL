import { describe, expect, it } from "vitest";

import { buildGalaxyArtifacts } from "../galaxy/build-artifacts";
import { decodeFullGalaxy } from "../galaxy/full-codec";
import { buildListGraph, toLiteGraph } from "./graph";
import { toPublicGraphInputs } from "./graph-input";
import { factualEvidenceFor, isSensePublishable, isWordPublic, publicationStatusFor } from "./publication";
import { vocabularyRecordFixture } from "./test-fixtures";

const sourceRef = (sourceId: string) => ({
  sourceId,
  externalId: null,
  url: null,
  retrievedAt: null,
  contentHash: null,
});

function advancedFixture() {
  const core = vocabularyRecordFixture();
  const advanced = {
    ...vocabularyRecordFixture(),
    lemma: "master",
    display: "master",
    tier: "advanced" as const,
    status: "enriched" as const,
    sources: [sourceRef("llm")],
    senses: [{
      ...vocabularyRecordFixture().senses[0],
      sources: [sourceRef("llm")],
      examples: [{ text: "She mastered the material.", sources: [sourceRef("llm")] }],
      status: "published" as const,
    }],
    connections: [{
      ...vocabularyRecordFixture().connections[0],
      target: core.lemma,
      type: "builds_on" as const,
      gloss: "Builds on the core verb.",
      status: "published" as const,
    }],
  };
  return { core, advanced };
}

describe("vocabulary publication", () => {
  it("hides an LLM-only advanced record", () => {
    const { advanced } = advancedFixture();

    expect(publicationStatusFor(advanced)).toBe("hidden");
    expect(factualEvidenceFor(advanced, advanced.senses[0]!)).toBe("ai-draft");
    expect(isSensePublishable(advanced, advanced.senses[0]!)).toBe(false);
    expect(isWordPublic(advanced)).toBe(false);
  });

  it("keeps a source-backed core record public", () => {
    const record = vocabularyRecordFixture();

    expect(publicationStatusFor(record)).toBe("published");
    expect(isWordPublic(record)).toBe(true);
  });

  it("requires a sourced publishable sense and a glossed published connection to a public core word", () => {
    const { core, advanced } = advancedFixture();
    const supported = {
      ...advanced,
      sources: [sourceRef("wordnet")],
      senses: [{
        ...advanced.senses[0]!,
        sources: [sourceRef("wordnet")],
        examples: [{ text: "She mastered the material.", sources: [sourceRef("tatoeba")] }],
      }],
    };

    expect(publicationStatusFor(supported, [core, supported])).toBe("published");
    expect(isWordPublic(supported, [core, supported])).toBe(true);
    expect(publicationStatusFor({
      ...supported,
      connections: [{ ...supported.connections[0]!, gloss: null }],
    }, [core, supported])).toBe("hidden");
  });

  it("omits hidden advanced words from graph and galaxy artifacts", () => {
    const { core, advanced } = advancedFixture();
    const publicInputs = toPublicGraphInputs([core, advanced]);
    const graph = toLiteGraph(buildListGraph(publicInputs, "all"));
    const bundle = buildGalaxyArtifacts(graph, "All words");
    const full = decodeFullGalaxy(bundle.full.bytes.buffer.slice(
      bundle.full.bytes.byteOffset,
      bundle.full.bytes.byteOffset + bundle.full.bytes.byteLength,
    ));

    expect(graph.nodes.map((node) => node.lemma)).toEqual([core.lemma]);
    expect(bundle.search.data.entries.map((entry) => entry.lemma)).toEqual([core.lemma]);
    expect(bundle.chartShards.flatMap((shard) => shard.data.words.map((word) => word.lemma))).toEqual([core.lemma]);
    expect(full.words.map((word) => word.lemma)).toEqual([core.lemma]);
  });
});
