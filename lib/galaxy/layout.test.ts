import { describe, expect, it } from "vitest";

import { layoutGalaxy } from "./layout";
import { fixtureGraph as graph } from "./test-fixture";

describe("layoutGalaxy", () => {
  it("is deterministic and includes every word exactly once", () => {
    const a = layoutGalaxy(graph, "Fixture");
    const b = layoutGalaxy(graph, "Fixture");
    expect(a).toEqual(b);
    expect(a.words.map((word) => word.lemma).sort()).toEqual(["move", "speak", "talk", "zebra"]);
    expect(new Set(a.words.map((word) => word.lemma)).size).toBe(graph.nodes.length);
  });

  it("keeps drift visible and aggregates cross-chart links", () => {
    const result = layoutGalaxy(graph, "Fixture");
    expect(result.words.find((word) => word.lemma === "zebra")?.chartId).toBe("drift");
    expect(result.chartLinks).toContainEqual({ sourceChart: "motion", targetChart: "speech", weight: 1 });
  });

  it("uses themed names and finite frozen coordinates", () => {
    const result = layoutGalaxy(graph, "Fixture");
    expect(result.charts.find((chart) => chart.id === "speech")?.name).toBe("Speaking & Listening");
    for (const word of result.words) expect(word.xyz.every(Number.isFinite)).toBe(true);
  });
});
