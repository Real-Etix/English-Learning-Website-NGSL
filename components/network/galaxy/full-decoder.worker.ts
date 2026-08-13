import { decodeFullGalaxy, type FullGalaxyData } from "../../../lib/galaxy/full-codec";

type DecodeRequest = {
  type: "decode";
  buffer: ArrayBuffer;
  expectedVersion: string;
  expectedCount: number;
};

type DecodeReply =
  | { type: "ready"; data: FullGalaxyData }
  | { type: "error"; message: string };

type WorkerScope = {
  addEventListener(type: "message", listener: (event: MessageEvent<DecodeRequest>) => void): void;
  postMessage(message: DecodeReply, transfer?: Transferable[]): void;
};

const workerScope = self as unknown as WorkerScope;

workerScope.addEventListener("message", (event) => {
  if (event.data?.type !== "decode") return;
  try {
    const data = decodeFullGalaxy(event.data.buffer);
    if (data.version !== event.data.expectedVersion) throw new Error("Full galaxy version mismatch");
    if (data.words.length !== event.data.expectedCount) throw new Error("Full galaxy word count mismatch");
    workerScope.postMessage({ type: "ready", data }, [data.positions.buffer as ArrayBuffer]);
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Unable to prepare the full galaxy",
    });
  }
});
