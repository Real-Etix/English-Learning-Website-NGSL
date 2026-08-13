import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { buildGalaxyArtifacts } from "../../../lib/galaxy/build-artifacts";
import { fixtureGraph } from "../../../lib/galaxy/test-fixture";

import {
  FallbackConstellation,
  FULL_3D_UNAVAILABLE_MESSAGE,
  buildFallbackChartTargetProps,
  buildFallbackWordButtonProps,
  getFallbackFullModeControl,
  projectChartsToConstellation,
} from "./fallback-constellation";

const bundle = buildGalaxyArtifacts(fixtureGraph, "Fixture");
const manifest = bundle.manifest;
const speechShard = bundle.chartShards.find((item) => item.data.chartId === "speech")!.data;
const speechChart = manifest.charts.find((chart) => chart.id === "speech")!;

describe("projectChartsToConstellation", () => {
  it("projects chart centres into the stable fallback viewbox with accessible hit targets", () => {
    const projected = projectChartsToConstellation(manifest.charts);
    const speech = projected.find((chart) => chart.chart.id === "speech");

    expect(projected).toHaveLength(manifest.charts.length);
    expect(speech).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      radius: expect.any(Number),
    });
    expect(speech?.x).toBeGreaterThan(0);
    expect(speech?.x).toBeLessThan(1000);
    expect(speech?.y).toBeGreaterThan(0);
    expect(speech?.y).toBeLessThan(700);
    expect(speech?.radius).toBeGreaterThanOrEqual(28);
  });
});

describe("FallbackConstellation", () => {
  it("provides the exact disabled full-mode message for fallback UI controls", () => {
    expect(getFallbackFullModeControl("NGSL", "confirm", true)).toEqual({
      disabled: true,
      label: FULL_3D_UNAVAILABLE_MESSAGE,
    });
    expect(getFallbackFullModeControl("NGSL", "ready", false)).toEqual({
      disabled: false,
      label: "Return to NGSL constellation view",
    });
  });

  it("renders keyboard-operable chart targets and an aria-live word list for the selected shard", () => {
    const html = renderToStaticMarkup(
      <FallbackConstellation
        manifest={manifest}
        controller={{
          openChart: vi.fn(async () => speechShard),
          openWord: vi.fn(async () => true),
        }}
        selectedChartId="speech"
        selectedLemma="speak"
        selectedShard={speechShard}
        owned={new Set(["speak"])}
        used={new Set<string>()}
        route={new Set(["speak"])}
      />,
    );

    expect(html).toContain('viewBox="0 0 1000 700"');
    expect(html).not.toContain('role="img"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-fallback-hit-ring=""');
    expect(html).toContain('vector-effect="non-scaling-stroke"');
    expect(html).toContain(speechChart.name.replace("&", "&amp;"));
    expect(html).toContain("words ready");
    expect(html).toContain("speak");
    expect(html).toContain("Held");
    expect(html).toContain("Route");
  });

  it("keeps keyboard activation on chart groups without adding duplicate key handlers to native word buttons", () => {
    const openChart = vi.fn();
    const openWord = vi.fn();
    const preventDefault = vi.fn();

    const chartProps = buildFallbackChartTargetProps("speech", speechChart.name, speechChart.wordCount, openChart);
    const wordProps = buildFallbackWordButtonProps(openWord);

    chartProps.onKeyDown?.({ key: "Enter", preventDefault } as unknown as React.KeyboardEvent<SVGGElement>);
    chartProps.onKeyDown?.({ key: " ", preventDefault } as unknown as React.KeyboardEvent<SVGGElement>);
    expect(openChart).toHaveBeenCalledTimes(2);
    expect(preventDefault).toHaveBeenCalledTimes(2);

    expect("onKeyDown" in wordProps).toBe(false);
    wordProps.onClick();
    expect(openWord).toHaveBeenCalledTimes(1);
  });
});
