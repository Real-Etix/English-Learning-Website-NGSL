import type { FullGalaxyData } from "../../../lib/galaxy/full-codec";
import type { GalaxyManifest } from "../../../lib/galaxy/types";

import { downloadBytes } from "./asset-client";

export type FullLoadProgress = {
  stage: "downloading" | "preparing";
  loaded: number;
  total: number | null;
};

type FullGalaxyLoaderDependencies = {
  download?: typeof downloadBytes;
  createWorker?: () => Worker;
};

type WorkerReply =
  | { type: "ready"; data: FullGalaxyData }
  | { type: "error"; message: string };

function defaultWorker(): Worker {
  return new Worker(new URL("./full-decoder.worker.ts", import.meta.url));
}

function abortError(): DOMException {
  return new DOMException("Full galaxy loading was cancelled", "AbortError");
}

function errorMessage(event: ErrorEvent): string {
  return event.message || "Unable to prepare the full galaxy";
}

export class FullGalaxyLoader {
  private readonly download: typeof downloadBytes;
  private readonly createWorker: () => Worker;

  constructor(
    private readonly manifest: GalaxyManifest,
    dependencies: FullGalaxyLoaderDependencies = {},
  ) {
    this.download = dependencies.download ?? downloadBytes;
    this.createWorker = dependencies.createWorker ?? defaultWorker;
  }

  async load(input: {
    signal: AbortSignal;
    onProgress: (progress: FullLoadProgress) => void;
  }): Promise<FullGalaxyData> {
    const worker = this.createWorker();
    try {
      if (input.signal.aborted) throw abortError();
      const buffer = await this.download(this.manifest.assets.full.url, {
        signal: input.signal,
        onProgress: ({ loaded, total }) => input.onProgress({ stage: "downloading", loaded, total }),
      });
      if (input.signal.aborted) throw abortError();
      input.onProgress({ stage: "preparing", loaded: buffer.byteLength, total: buffer.byteLength });

      const data = await new Promise<FullGalaxyData>((resolve, reject) => {
        const cleanup = () => {
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
          input.signal.removeEventListener("abort", onAbort);
        };
        const settle = (action: () => void) => {
          cleanup();
          action();
        };
        const onMessage = (event: MessageEvent<WorkerReply>) => {
          const reply = event.data;
          if (reply?.type === "ready") settle(() => resolve(reply.data));
          else if (reply?.type === "error") settle(() => reject(new Error(reply.message)));
        };
        const onError = (event: ErrorEvent) => settle(() => reject(new Error(errorMessage(event))));
        const onAbort = () => settle(() => reject(abortError()));
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        input.signal.addEventListener("abort", onAbort, { once: true });
        if (input.signal.aborted) {
          onAbort();
          return;
        }
        try {
          worker.postMessage({
            type: "decode",
            buffer,
            expectedVersion: this.manifest.version,
            expectedCount: this.manifest.list.wordCount,
          }, [buffer]);
        } catch (error) {
          settle(() => reject(error));
        }
      });

      if (data.version !== this.manifest.version) throw new Error("Full galaxy version mismatch");
      if (data.listSlug !== this.manifest.list.slug) throw new Error("Full galaxy list mismatch");
      if (data.words.length !== this.manifest.list.wordCount) throw new Error("Full galaxy word count mismatch");
      return data;
    } finally {
      worker.terminate();
    }
  }
}
