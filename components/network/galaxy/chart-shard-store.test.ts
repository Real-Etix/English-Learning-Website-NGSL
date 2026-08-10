import { describe, expect, it, vi } from "vitest";

import { GalaxyAssetError, downloadBytes, fetchVersionedJson } from "./asset-client";
import { ChartShardStore } from "./chart-shard-store";
import { buildGalaxyArtifacts } from "../../../lib/galaxy/build-artifacts";
import { fixtureGraph } from "../../../lib/galaxy/test-fixture";
import type { ChartShard, GalaxyManifest } from "../../../lib/galaxy/types";

const bundle = buildGalaxyArtifacts(fixtureGraph, "Fixture");
const manifest = bundle.manifest;
const shards = new Map(bundle.chartShards.map((item) => [item.data.chartId, item.data]));

function shardFetcher(overrides: Partial<Record<string, ChartShard>> = {}): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const chart = manifest.charts.find((item) => item.asset.url === String(input));
    const shard = chart ? (overrides[chart.id] ?? shards.get(chart.id)) : null;
    return shard
      ? new Response(JSON.stringify(shard), { status: 200 })
      : new Response("missing", { status: 404 });
  }) as typeof fetch;
}

describe("fetchVersionedJson", () => {
  it("rejects invalid asset JSON before it reaches a loader", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ version: manifest.version }), { status: 200 })) as typeof fetch;

    await expect(fetchVersionedJson("/chart.json", manifest.version, new AbortController().signal, (value): value is ChartShard => (
      typeof value === "object" && value !== null && "chartId" in value
    ), fetcher)).rejects.toMatchObject({ code: "decode" satisfies GalaxyAssetError["code"] });
  });

  it("preserves AbortError instead of wrapping it", async () => {
    const abort = new DOMException("Cancelled", "AbortError");
    const fetcher = vi.fn(async () => { throw abort; }) as typeof fetch;

    await expect(fetchVersionedJson("/chart.json", manifest.version, new AbortController().signal, (value): value is { version: string } => {
      void value;
      return true;
    }, fetcher))
      .rejects.toBe(abort);
  });
});

describe("downloadBytes", () => {
  it("reports progress for each streamed chunk", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    const progress = vi.fn();

    await expect(downloadBytes("/full.bin", {
      signal: new AbortController().signal,
      onProgress: progress,
      fetcher: vi.fn(async () => new Response(stream, { headers: { "content-length": "3" } })) as typeof fetch,
    })).resolves.toEqual(new Uint8Array([1, 2, 3]).buffer);
    expect(progress).toHaveBeenNthCalledWith(1, { loaded: 2, total: 3 });
    expect(progress).toHaveBeenNthCalledWith(2, { loaded: 3, total: 3 });
  });
});

describe("ChartShardStore", () => {
  it.each([
    ["word", (shard: ChartShard) => Object.assign(shard.words[0] as unknown as Record<string, unknown>, {
      tier: "expert",
      rank: "10",
      degree: null,
      xyz: [0, "not-a-number", 2],
    })],
    ["edge", (shard: ChartShard) => Object.assign(shard.edges[0] as unknown as Record<string, unknown>, { target: 42 })],
    ["portal", (shard: ChartShard) => Object.assign(shard.portals[0] as unknown as Record<string, unknown>, { targetChart: 42 })],
  ])("rejects a malformed nested %s at the fetch guard boundary", async (_kind, mutate) => {
    const malformed = structuredClone(shards.get("speech")!);
    mutate(malformed);
    const fetcher = vi.fn(async () => new Response(JSON.stringify(malformed), { status: 200 })) as typeof fetch;
    const store = new ChartShardStore(manifest, { capacity: 2, concurrency: 1, fetcher });

    await expect(store.load("speech")).rejects.toMatchObject({
      code: "decode",
      cause: { message: "Asset shape did not match its guard" },
    });
    expect(store.get("speech")).toBeNull();
  });

  it("deduplicates concurrent chart loads", async () => {
    const fetcher = shardFetcher();
    const store = new ChartShardStore(manifest, { capacity: 2, concurrency: 2, fetcher });

    const [a, b] = await Promise.all([store.load("speech"), store.load("speech")]);

    expect(a).toBe(b);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("runs a queued foreground load before queued prefetches", async () => {
    const pending = new Map<string, () => void>();
    const fetcher = vi.fn((input: string | URL | Request) => new Promise<Response>((resolve) => {
      const chart = manifest.charts.find((item) => item.asset.url === String(input));
      pending.set(chart!.id, () => resolve(new Response(JSON.stringify(shards.get(chart!.id)), { status: 200 })));
    })) as typeof fetch;
    const store = new ChartShardStore(manifest, { capacity: 3, concurrency: 1, fetcher });

    store.prefetch("speech");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    store.prefetch("motion");
    const drift = store.load("drift");
    pending.get("speech")!();

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(String(vi.mocked(fetcher).mock.calls[1][0])).toBe(manifest.charts.find((chart) => chart.id === "drift")!.asset.url);
    pending.get("drift")!();
    await drift;
  });

  it("limits simultaneous fetches to the configured concurrency", async () => {
    const releases: (() => void)[] = [];
    let active = 0;
    let maximumActive = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      const chart = manifest.charts.find((item) => item.asset.url === String(input));
      return new Response(JSON.stringify(shards.get(chart!.id)), { status: 200 });
    }) as typeof fetch;
    const store = new ChartShardStore(manifest, { capacity: 3, concurrency: 2, fetcher });
    const loads = [store.load("speech"), store.load("motion"), store.load("drift")];

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(maximumActive).toBe(2);
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    releases.splice(0).forEach((release) => release());
    await expect(Promise.all(loads)).resolves.toHaveLength(3);
  });

  it("retries a later request after a failed fetch", async () => {
    const successful = shardFetcher();
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(successful);
    const store = new ChartShardStore(manifest, { capacity: 2, concurrency: 1, fetcher });

    await expect(store.load("speech")).rejects.toMatchObject({ code: "network" });
    await expect(store.load("speech")).resolves.toEqual(shards.get("speech"));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries exactly once against a refreshed manifest after a version mismatch", async () => {
    const refreshed: GalaxyManifest = {
      ...manifest,
      charts: manifest.charts.map((chart) => chart.id === "speech"
        ? { ...chart, asset: { ...chart.asset, url: "/refreshed-speech.json" } }
        : chart),
    };
    const oldShard = { ...shards.get("speech")!, version: "outdated" };
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const value = String(input) === "/refreshed-speech.json" ? shards.get("speech") : oldShard;
      return new Response(JSON.stringify(value), { status: 200 });
    }) as typeof fetch;
    const refreshManifest = vi.fn(async () => refreshed);
    const store = new ChartShardStore(manifest, { capacity: 2, concurrency: 1, fetcher, refreshManifest });

    await expect(store.load("speech")).resolves.toEqual(shards.get("speech"));
    expect(refreshManifest).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("surfaces a second version mismatch", async () => {
    const fetcher = shardFetcher({ speech: { ...shards.get("speech")!, version: "outdated" } });
    const refreshManifest = vi.fn(async () => manifest);
    const store = new ChartShardStore(manifest, { capacity: 2, concurrency: 1, fetcher, refreshManifest });

    await expect(store.load("speech")).rejects.toMatchObject({ code: "version" });
    expect(refreshManifest).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used unpinned shard", async () => {
    const store = new ChartShardStore(manifest, { capacity: 2, concurrency: 2, fetcher: shardFetcher() });

    await store.load("speech");
    await store.load("motion");
    await store.load("drift");

    expect(store.residentIds()).toEqual(["motion", "drift"]);
  });

  it("keeps pinned shards resident while evicting unpinned ones", async () => {
    const store = new ChartShardStore(manifest, { capacity: 2, concurrency: 2, fetcher: shardFetcher() });

    await store.load("speech", { pin: true });
    await store.load("motion");
    await store.load("drift");

    expect(store.residentIds()).toEqual(["speech", "drift"]);
  });

  it("aborts pending work when disposed", async () => {
    const fetcher = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    })) as typeof fetch;
    const store = new ChartShardStore(manifest, { capacity: 2, concurrency: 1, fetcher });
    const pending = store.load("speech");

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    store.dispose();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
