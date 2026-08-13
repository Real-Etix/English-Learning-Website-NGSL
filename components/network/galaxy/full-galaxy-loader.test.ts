import { describe, expect, it, vi } from "vitest";

import { buildGalaxyArtifacts } from "../../../lib/galaxy/build-artifacts";
import { decodeFullGalaxy, type FullGalaxyData } from "../../../lib/galaxy/full-codec";
import { fixtureGraph } from "../../../lib/galaxy/test-fixture";

import { FullGalaxyLoader } from "./full-galaxy-loader";

const bundle = buildGalaxyArtifacts(fixtureGraph, "Fixture");
const manifest = bundle.manifest;
const decoded = decodeFullGalaxy(
  bundle.full.bytes.buffer.slice(
    bundle.full.bytes.byteOffset,
    bundle.full.bytes.byteOffset + bundle.full.bytes.byteLength,
  ),
);

type WorkerReply =
  | { type: "ready"; data: FullGalaxyData }
  | { type: "error"; message: string };

class FakeWorker extends EventTarget {
  terminate = vi.fn();
  postMessage = vi.fn((message: unknown, transfer?: Transferable[]) => {
    void message;
    void transfer;
    queueMicrotask(() => this.dispatchEvent(new MessageEvent<WorkerReply>("message", {
      data: { type: "ready", data: decoded },
    })));
  });
}

function copiedFullBuffer(): ArrayBuffer {
  return bundle.full.bytes.slice().buffer as ArrayBuffer;
}

describe("FullGalaxyLoader", () => {
  it("reports download and preparation progress before returning exact data", async () => {
    const worker = new FakeWorker();
    const loader = new FullGalaxyLoader(manifest, {
      download: async (_url, { onProgress }) => {
        onProgress({ loaded: bundle.full.bytes.byteLength, total: bundle.full.bytes.byteLength });
        return copiedFullBuffer();
      },
      createWorker: () => worker as unknown as Worker,
    });
    const events: string[] = [];

    const data = await loader.load({
      signal: new AbortController().signal,
      onProgress: (progress) => events.push(progress.stage),
    });

    expect(events).toEqual(["downloading", "preparing"]);
    expect(data.words).toHaveLength(manifest.list.wordCount);
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "decode",
      expectedVersion: manifest.version,
      expectedCount: manifest.list.wordCount,
    }), expect.any(Array));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("aborts the download signal and terminates worker resources", async () => {
    const worker = new FakeWorker();
    let downloadSignal: AbortSignal | undefined;
    const loader = new FullGalaxyLoader(manifest, {
      download: async (_url, options) => {
        downloadSignal = options.signal;
        await new Promise<void>((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
        });
        throw new Error("unreachable");
      },
      createWorker: () => worker as unknown as Worker,
    });
    const controller = new AbortController();

    const pending = loader.load({ signal: controller.signal, onProgress: () => undefined });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(downloadSignal?.aborted).toBe(true);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each([
    ["version", { ...decoded, version: "stale-version" }],
    ["word count", { ...decoded, words: decoded.words.slice(1) }],
  ])("rejects a worker result with the wrong %s before returning data", async (_case, data) => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {
      queueMicrotask(() => worker.dispatchEvent(new MessageEvent<WorkerReply>("message", {
        data: { type: "ready", data },
      })));
    });
    const loader = new FullGalaxyLoader(manifest, {
      download: async () => copiedFullBuffer(),
      createWorker: () => worker as unknown as Worker,
    });

    await expect(loader.load({
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })).rejects.toThrow(/version|word count/i);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("surfaces worker decode errors without fabricating data", async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {
      queueMicrotask(() => worker.dispatchEvent(new MessageEvent<WorkerReply>("message", {
        data: { type: "error", message: "Invalid full galaxy payload" },
      })));
    });
    const loader = new FullGalaxyLoader(manifest, {
      download: async () => copiedFullBuffer(),
      createWorker: () => worker as unknown as Worker,
    });

    await expect(loader.load({
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })).rejects.toThrow("Invalid full galaxy payload");
  });
});
