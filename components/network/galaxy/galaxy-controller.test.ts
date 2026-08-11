import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildGalaxyArtifacts } from "../../../lib/galaxy/build-artifacts";
import { fixtureGraph } from "../../../lib/galaxy/test-fixture";
import type { ChartShard } from "../../../lib/galaxy/types";

import { GalaxyController, galaxyStoreOptions } from "./galaxy-controller";

const bundle = buildGalaxyArtifacts(fixtureGraph, "Fixture");
const manifest = bundle.manifest;
const shards = new Map(bundle.chartShards.map((item) => [item.data.chartId, item.data]));
const speechShard = shards.get("speech")!;
const searchData = bundle.search.data;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setup(load = vi.fn(async (chartId: string) => shards.get(chartId)!)) {
  const store = {
    load,
    prefetch: vi.fn(),
    pin: vi.fn(),
    unpin: vi.fn(),
    dispose: vi.fn(),
  };
  const catalog = {
    load: vi.fn(async () => searchData.entries),
    find: vi.fn((query: string) => searchData.entries.filter((entry) => entry.normalized.includes(query))),
    get: vi.fn((lemma: string) => searchData.entries.find((entry) => entry.lemma === lemma) ?? null),
  };
  const engine = {
    upsertChart: vi.fn(),
    removeChart: vi.fn(),
    setChart: vi.fn(),
    focusStar: vi.fn(() => true),
  };
  const controller = new GalaxyController({ manifest, store, catalog, engine, saveData: false });
  return { controller, store, catalog, engine };
}

describe("GalaxyController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("loads a chart before installing it in the engine", async () => {
    const { controller, store, engine } = setup();

    await controller.openChart("speech");

    expect(store.load).toHaveBeenCalledWith("speech", { pin: true });
    expect(engine.upsertChart).toHaveBeenCalledWith(speechShard);
    expect(engine.setChart).toHaveBeenCalledWith("speech");
    expect(store.load.mock.invocationCallOrder[0]).toBeLessThan(engine.upsertChart.mock.invocationCallOrder[0]);
  });

  it("unpins the previous foreground chart only after the next chart is installed", async () => {
    const { controller, store, engine } = setup();
    await controller.openChart("speech");

    await controller.openChart("motion");

    expect(store.unpin).toHaveBeenCalledWith("speech");
    expect(engine.setChart.mock.invocationCallOrder.at(-1)).toBeLessThan(store.unpin.mock.invocationCallOrder[0]);
  });

  it("resolves search, loads its chart, then focuses the real star", async () => {
    const { controller, catalog, engine } = setup();

    const result = await controller.openWord("speak");

    expect(result).toBe(true);
    expect(catalog.load).toHaveBeenCalledOnce();
    expect(engine.upsertChart).toHaveBeenCalledWith(speechShard);
    expect(engine.focusStar).toHaveBeenCalledWith("speak", { keepCamera: false });
  });

  it("does not focus a superseded word after its chart request resolves", async () => {
    const pendingSpeech = deferred<ChartShard>();
    const load = vi.fn((chartId: string) => chartId === "speech"
      ? pendingSpeech.promise
      : Promise.resolve(shards.get(chartId)!));
    const { controller, engine } = setup(load);

    const stale = controller.openWord("speak");
    const current = controller.openWord("move");
    await current;
    pendingSpeech.resolve(speechShard);
    await stale;

    expect(engine.focusStar).toHaveBeenCalledTimes(1);
    expect(engine.focusStar).toHaveBeenCalledWith("move", { keepCamera: false });
  });

  it("cancels a pending chart selection when the constellation view is restored", async () => {
    const pending = deferred<ChartShard>();
    const { controller, store, engine } = setup(vi.fn(() => pending.promise));
    const opening = controller.openChart("speech");

    controller.clearSelection();
    pending.resolve(speechShard);
    await opening;

    expect(engine.upsertChart).not.toHaveBeenCalled();
    expect(engine.setChart).toHaveBeenCalledWith(null);
    expect(store.unpin).toHaveBeenCalledWith("speech");
  });

  it("retries the selected chart after a failed shard request", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(speechShard);
    const { controller, engine } = setup(load);
    const statuses: string[] = [];
    controller.subscribe((status) => statuses.push(status.chartLoad));

    expect(await controller.openChart("speech")).toBeNull();
    expect(await controller.retryChart()).toBe(speechShard);

    expect(load).toHaveBeenCalledTimes(2);
    expect(statuses).toContain("error");
    expect(statuses.at(-1)).toBe("ready");
    expect(engine.setChart).toHaveBeenCalledWith("speech");
  });

  it("reports a catalog failure and allows the catalog to be retried", async () => {
    const { controller, catalog } = setup();
    catalog.load.mockRejectedValueOnce(new Error("offline"));
    const statuses: string[] = [];
    controller.subscribe((status) => statuses.push(status.searchLoad));

    expect(await controller.loadCatalog()).toBeNull();
    expect(await controller.loadCatalog()).toEqual(searchData.entries);

    expect(statuses).toContain("error");
    expect(statuses.at(-1)).toBe("ready");
  });

  it("loads the approached chart but suppresses neighbour prefetch with Save-Data", async () => {
    const { controller, store, engine } = setup();
    controller.setSaveData(true);

    controller.approachChart("motion");
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.load).toHaveBeenCalledWith("motion", { pin: false });
    expect(engine.upsertChart).toHaveBeenCalledWith(shards.get("motion"));
    expect(engine.setChart).not.toHaveBeenCalled();
    expect(store.prefetch).not.toHaveBeenCalled();
  });

  it("prefetches the strongest unloaded neighbour after 750 ms of quiet", async () => {
    const { controller, store } = setup();

    controller.approachChart("speech");
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(749);
    expect(store.prefetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    const strongest = manifest.charts.find((chart) => chart.id === "speech")!.neighbors
      .toSorted((left, right) => right.weight - left.weight)[0]?.chartId;
    if (strongest) expect(store.prefetch).toHaveBeenCalledWith(strongest);
  });

  it("cancels a scheduled neighbour prefetch when a chart is opened", async () => {
    const { controller, store } = setup();
    controller.approachChart("speech");
    await vi.runAllTicks();

    await controller.openChart("motion");
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.prefetch).not.toHaveBeenCalled();
  });

  it("cancels a scheduled neighbour prefetch when a word is opened", async () => {
    const { controller, store } = setup();
    controller.approachChart("speech");
    await vi.runAllTicks();

    await controller.openWord("move");
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.prefetch).not.toHaveBeenCalled();
  });

  it("cancels a scheduled neighbour prefetch when search input changes", async () => {
    const { controller, store } = setup();
    controller.approachChart("speech");
    await vi.runAllTicks();

    await controller.search("move");
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.prefetch).not.toHaveBeenCalled();
  });

  it("cancels a scheduled neighbour prefetch when selection is cleared", async () => {
    const { controller, store } = setup();
    controller.approachChart("speech");
    await vi.runAllTicks();

    controller.clearSelection();
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.prefetch).not.toHaveBeenCalled();
  });

  it("cancels a scheduled neighbour prefetch when a failed chart is retried", async () => {
    const load = vi.fn(async (chartId: string) => {
      if (chartId === "motion" && load.mock.calls.filter(([id]) => id === "motion").length === 1) {
        throw new Error("offline");
      }
      return shards.get(chartId)!;
    });
    const { controller, store } = setup(load);
    await controller.openChart("motion");
    controller.approachChart("speech");
    await vi.runAllTicks();

    await controller.retryChart();
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.prefetch).not.toHaveBeenCalled();
  });

  it("allows an evicted prefetched chart to become the strongest unloaded neighbour again", async () => {
    const { controller, store } = setup();
    const strongest = manifest.charts.find((chart) => chart.id === "speech")!.neighbors
      .toSorted((left, right) => right.weight - left.weight)[0]?.chartId;
    expect(strongest).toBeTruthy();

    controller.approachChart("speech");
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(750);
    controller.evictChart(strongest!);

    controller.approachChart("speech");
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(750);

    expect(store.prefetch).toHaveBeenCalledTimes(2);
    expect(store.prefetch).toHaveBeenLastCalledWith(strongest);
  });

  it("cancels pending prefetch and ignores loads after disposal", async () => {
    const pending = deferred<ChartShard>();
    const { controller, store, engine } = setup(vi.fn(() => pending.promise));
    controller.approachChart("speech");

    controller.dispose();
    pending.resolve(speechShard);
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.dispose).toHaveBeenCalledOnce();
    expect(engine.upsertChart).not.toHaveBeenCalled();
    expect(store.prefetch).not.toHaveBeenCalled();
  });

  it("uses bounded mobile and desktop store capacities", () => {
    expect(galaxyStoreOptions(true)).toEqual({ capacity: 3, concurrency: 2 });
    expect(galaxyStoreOptions(false)).toEqual({ capacity: 8, concurrency: 4 });
  });
});
