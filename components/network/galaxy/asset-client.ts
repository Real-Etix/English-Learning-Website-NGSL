export type ByteProgress = { loaded: number; total: number | null };

export class GalaxyAssetError extends Error {
  constructor(
    public code: "network" | "version" | "decode",
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "GalaxyAssetError";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export async function fetchVersionedJson<T extends { version: string }>(
  url: string,
  version: string,
  signal: AbortSignal,
  guard: (value: unknown) => value is T,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, { signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new GalaxyAssetError("network", "Galaxy asset request failed", error);
  }
  if (!response.ok) throw new GalaxyAssetError("network", `Asset request failed (${response.status})`);

  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new GalaxyAssetError("decode", "Invalid galaxy asset", error);
  }

  try {
    if (!guard(value)) throw new Error("Asset shape did not match its guard");
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new GalaxyAssetError("decode", "Invalid galaxy asset", error);
  }
  if (value.version !== version) throw new GalaxyAssetError("version", "Galaxy asset version mismatch");
  return value;
}

export async function downloadBytes(
  url: string,
  options: { signal: AbortSignal; onProgress: (progress: ByteProgress) => void; fetcher?: typeof fetch },
): Promise<ArrayBuffer> {
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(url, { signal: options.signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new GalaxyAssetError("network", "Galaxy asset request failed", error);
  }
  if (!response.ok) throw new GalaxyAssetError("network", `Asset request failed (${response.status})`);
  if (!response.body) throw new GalaxyAssetError("decode", "Invalid galaxy asset");

  const header = response.headers.get("content-length");
  const total = header && /^\d+$/.test(header) ? Number(header) : null;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      options.onProgress({ loaded, total });
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new GalaxyAssetError("network", "Galaxy asset download failed", error);
  }

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
