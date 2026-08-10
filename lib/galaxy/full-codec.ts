export type FullGalaxyData = {
  version: string;
  listSlug: string;
  words: { lemma: string; display: string; chartId: string; partOfSpeech: string }[];
  positions: Float32Array;
  tiers: Uint8Array;
  ranks: Int32Array;
  degrees: Uint16Array;
};

const align4 = (value: number) => (value + 3) & ~3;
const MAGIC = [0x53, 0x41, 0x54, 0x31] as const;
const HEADER_OFFSET = MAGIC.length + Uint32Array.BYTES_PER_ELEMENT;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function invalidPayload(): never {
  throw new Error("Invalid full galaxy payload");
}

function assertValidData(data: FullGalaxyData): void {
  if (
    typeof data.version !== "string"
    || typeof data.listSlug !== "string"
    || !Array.isArray(data.words)
    || !(data.positions instanceof Float32Array)
    || !(data.tiers instanceof Uint8Array)
    || !(data.ranks instanceof Int32Array)
    || !(data.degrees instanceof Uint16Array)
  ) invalidPayload();
  if (data.positions.length !== data.words.length * 3 || data.tiers.length !== data.words.length
    || data.ranks.length !== data.words.length || data.degrees.length !== data.words.length) invalidPayload();
  for (const word of data.words) {
    if (!word || typeof word !== "object" || typeof word.lemma !== "string" || typeof word.display !== "string"
      || typeof word.chartId !== "string" || typeof word.partOfSpeech !== "string") invalidPayload();
  }
}

function checkedEnd(offset: number, length: number, total: number): number {
  const end = offset + length;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || !Number.isSafeInteger(end)
    || offset < 0 || length < 0 || end > total) invalidPayload();
  return end;
}

export function encodeFullGalaxy(data: FullGalaxyData): Uint8Array {
  assertValidData(data);
  const header = encoder.encode(JSON.stringify({ version: data.version, listSlug: data.listSlug, words: data.words }));
  const positionsOffset = align4(HEADER_OFFSET + header.byteLength);
  const tiersOffset = positionsOffset + data.positions.byteLength;
  const ranksOffset = align4(tiersOffset + data.tiers.byteLength);
  const degreesOffset = ranksOffset + data.ranks.byteLength;
  const byteLength = degreesOffset + data.degrees.byteLength;
  if (!Number.isSafeInteger(byteLength) || byteLength < degreesOffset) invalidPayload();

  const bytes = new Uint8Array(byteLength);
  bytes.set(MAGIC, 0);
  new DataView(bytes.buffer).setUint32(MAGIC.length, header.byteLength, true);
  bytes.set(header, HEADER_OFFSET);
  new Float32Array(bytes.buffer, positionsOffset, data.positions.length).set(data.positions);
  new Uint8Array(bytes.buffer, tiersOffset, data.tiers.length).set(data.tiers);
  new Int32Array(bytes.buffer, ranksOffset, data.ranks.length).set(data.ranks);
  new Uint16Array(bytes.buffer, degreesOffset, data.degrees.length).set(data.degrees);
  return bytes;
}

export function decodeFullGalaxy(buffer: ArrayBufferLike): FullGalaxyData {
  const isBuffer = buffer instanceof ArrayBuffer
    || (typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer);
  if (!isBuffer || buffer.byteLength < HEADER_OFFSET) invalidPayload();
  const bytes = new Uint8Array(buffer);
  if (!MAGIC.every((value, index) => bytes[index] === value)) invalidPayload();

  const headerLength = new DataView(buffer).getUint32(MAGIC.length, true);
  const headerEnd = checkedEnd(HEADER_OFFSET, headerLength, buffer.byteLength);
  const positionsOffset = align4(headerEnd);
  if (positionsOffset < headerEnd || positionsOffset > buffer.byteLength) invalidPayload();

  let header: Pick<FullGalaxyData, "version" | "listSlug" | "words">;
  try {
    header = JSON.parse(decoder.decode(new Uint8Array(buffer, HEADER_OFFSET, headerLength))) as Pick<FullGalaxyData, "version" | "listSlug" | "words">;
  } catch {
    invalidPayload();
  }
  if (!header || typeof header !== "object" || typeof header.version !== "string"
    || typeof header.listSlug !== "string" || !Array.isArray(header.words)) invalidPayload();

  const wordCount = header.words.length;
  const positionsLength = wordCount * 3;
  const positionsEnd = checkedEnd(positionsOffset, positionsLength * Float32Array.BYTES_PER_ELEMENT, buffer.byteLength);
  const tiersOffset = positionsEnd;
  const tiersEnd = checkedEnd(tiersOffset, wordCount * Uint8Array.BYTES_PER_ELEMENT, buffer.byteLength);
  const ranksOffset = align4(tiersEnd);
  if (ranksOffset < tiersEnd || ranksOffset > buffer.byteLength) invalidPayload();
  const ranksEnd = checkedEnd(ranksOffset, wordCount * Int32Array.BYTES_PER_ELEMENT, buffer.byteLength);
  const degreesOffset = ranksEnd;
  const degreesEnd = checkedEnd(degreesOffset, wordCount * Uint16Array.BYTES_PER_ELEMENT, buffer.byteLength);
  if (degreesEnd !== buffer.byteLength) invalidPayload();

  const data: FullGalaxyData = {
    ...header,
    positions: new Float32Array(buffer, positionsOffset, positionsLength),
    tiers: new Uint8Array(buffer, tiersOffset, wordCount),
    ranks: new Int32Array(buffer, ranksOffset, wordCount),
    degrees: new Uint16Array(buffer, degreesOffset, wordCount),
  };
  assertValidData(data);
  return data;
}
