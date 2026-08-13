import { describe, expect, it } from "vitest";

import { GalaxyQualityController, degradeQuality, initialQuality } from "./quality";

describe("initialQuality", () => {
  it("starts mobile with bounded DPR and three resident charts", () => {
    expect(initialQuality({ width: 390, devicePixelRatio: 3, reducedMotion: false })).toMatchObject({
      tier: "mobile",
      pixelRatio: 1.25,
      residentCharts: 3,
    });
  });

  it("degrades effects before interaction content", () => {
    const degraded = degradeQuality(initialQuality({ width: 1440, devicePixelRatio: 2, reducedMotion: false }));
    expect(degraded.backgroundStars).toBeLessThan(1500);
    expect(degraded.residentCharts).toBe(8);
  });

  it("removes decorative motion for reduced-motion users", () => {
    expect(initialQuality({ width: 390, devicePixelRatio: 2, reducedMotion: true }).twinkle).toBe(false);
  });
});

describe("GalaxyQualityController", () => {
  it("waits 120 slow frames before degrading and another 120 before the next step", () => {
    const controller = new GalaxyQualityController(initialQuality({
      width: 1440,
      devicePixelRatio: 2,
      reducedMotion: false,
    }));

    for (let index = 0; index < 119; index++) {
      expect(controller.sample(40)).toBeNull();
    }

    const first = controller.sample(40);
    expect(first).not.toBeNull();
    expect(first?.backgroundStars).toBeLessThan(1500);
    expect(first?.glow).toBe(2);

    for (let index = 0; index < 119; index++) {
      expect(controller.sample(40)).toBeNull();
    }

    const second = controller.sample(40);
    expect(second).not.toBeNull();
    expect(second?.backgroundStars).toBe(first?.backgroundStars);
    expect(second?.glow).toBe(1);
  });
});
