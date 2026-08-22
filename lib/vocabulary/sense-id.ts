import { createHash } from "node:crypto";

export type SenseIdInput = {
  lemma: string;
  sourceId: string;
  externalId: string;
  partOfSpeech: string;
  definition: string;
};

function normalizeIdentityText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Creates a stable identity without changing the source wording persisted on the sense. */
export function senseIdFor(input: SenseIdInput): string {
  const material = [
    normalizeIdentityText(input.lemma),
    normalizeIdentityText(input.sourceId),
    normalizeIdentityText(input.externalId),
    normalizeIdentityText(input.partOfSpeech),
    normalizeIdentityText(input.definition),
  ].join("\u0000");
  return `source-${createHash("sha256").update(material, "utf8").digest("hex").slice(0, 20)}`;
}
