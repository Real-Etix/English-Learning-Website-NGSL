import { describe, expect, it } from "vitest";

import { initialFullModeState, reduceFullMode } from "./full-mode-state";

describe("reduceFullMode", () => {
  it("requires opening the confirmation before loading can start", () => {
    expect(reduceFullMode(initialFullModeState, { type: "confirm" })).toEqual(initialFullModeState);
    const confirmation = reduceFullMode(initialFullModeState, { type: "open" });
    expect(confirmation).toEqual({ phase: "confirm" });
    expect(reduceFullMode(confirmation, { type: "confirm" })).toEqual({
      phase: "loading",
      stage: "downloading",
      loaded: 0,
      total: null,
    });
  });

  it("tracks download and preparation progress only while loading", () => {
    const loading = reduceFullMode({ phase: "confirm" }, { type: "confirm" });
    const downloading = reduceFullMode(loading, {
      type: "progress",
      stage: "downloading",
      loaded: 128,
      total: 512,
    });
    expect(downloading).toEqual({ phase: "loading", stage: "downloading", loaded: 128, total: 512 });
    expect(reduceFullMode(downloading, {
      type: "progress",
      stage: "preparing",
      loaded: 512,
      total: 512,
    })).toEqual({ phase: "loading", stage: "preparing", loaded: 512, total: 512 });
  });

  it.each(["cancel", "exit"] as const)("returns to idle after %s from every phase", (type) => {
    for (const state of [
      { phase: "confirm" } as const,
      { phase: "loading", stage: "preparing", loaded: 1, total: 1 } as const,
      { phase: "ready" } as const,
      { phase: "error", message: "failed" } as const,
    ]) {
      expect(reduceFullMode(state, { type })).toEqual(initialFullModeState);
    }
  });

  it("allows retry only from an error", () => {
    expect(reduceFullMode({ phase: "error", message: "failed" }, { type: "confirm" }).phase).toBe("loading");
    expect(reduceFullMode({ phase: "ready" }, { type: "confirm" })).toEqual({ phase: "ready" });
  });
});
