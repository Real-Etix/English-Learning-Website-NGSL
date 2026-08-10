import { describe, expect, it } from "vitest";

import { buildGalaxyArtifacts } from "../../../lib/galaxy/build-artifacts";
import { decodeFullGalaxy } from "../../../lib/galaxy/full-codec";
import { fixtureGraph } from "../../../lib/galaxy/test-fixture";

import { GalaxySceneModel } from "./scene-model";

const bundle = buildGalaxyArtifacts(fixtureGraph, "Fixture");
const manifest = bundle.manifest;
const speechShard = bundle.chartShards.find((item) => item.data.chartId === "speech")!.data;
const motionShard = bundle.chartShards.find((item) => item.data.chartId === "motion")!.data;
const fullData = decodeFullGalaxy(
  bundle.full.bytes.buffer.slice(bundle.full.bytes.byteOffset, bundle.full.bytes.byteOffset + bundle.full.bytes.byteLength),
);

describe("GalaxySceneModel", () => {
  it("starts with proxy charts and no resident real words", () => {
    const model = new GalaxySceneModel(manifest);

    expect(model.view()).toBe("constellation");
    expect(model.residentWords()).toHaveLength(0);
  });

  it("adds and evicts one chart without disturbing another", () => {
    const model = new GalaxySceneModel(manifest);
    model.upsertChart(speechShard);
    model.upsertChart(motionShard);
    model.removeChart("speech");

    expect(model.residentWords().map((word) => word.lemma)).toEqual(motionShard.words.map((word) => word.lemma));
  });

  it("tracks chart view independently from shard residency", () => {
    const model = new GalaxySceneModel(manifest);
    model.upsertChart(speechShard);
    model.setChart("speech");

    expect(model.view()).toBe("chart");
    model.setChart(null);
    expect(model.view()).toBe("constellation");
  });

  it("enters full mode with the exact decoded count and releases it", () => {
    const model = new GalaxySceneModel(manifest);
    model.enterFull(fullData);

    expect(model.view()).toBe("full");
    expect(model.wordCount()).toBe(manifest.list.wordCount);
    expect(model.getWord("speak")).toMatchObject({ lemma: "speak", tier: "core", rank: 10 });
    model.exitFull();
    expect(model.view()).toBe("constellation");
  });

  it("prioritizes contextual labels and bounds the result", () => {
    const model = new GalaxySceneModel(manifest);
    model.enterFull(fullData);

    const labels = model.labelCandidates({
      focus: "zebra",
      hover: "move",
      route: new Set(["talk", "speak"]),
      claimed: new Set(["speak", "move"]),
      max: 3,
    });

    expect(labels.map((word) => word.lemma)).toEqual(["zebra", "move", "talk"]);
    expect(model.labelCandidates({ max: 200 })).toHaveLength(manifest.list.wordCount);
  });
});
