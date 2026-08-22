import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createGeneratedWordStore } from "./generated-word-store";
import { vocabularyRecordFixture } from "./test-fixtures";

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "generated-word-store-"));
}

function recordFor(lemma: string) {
  return { ...vocabularyRecordFixture(), lemma, display: lemma, connections: [] };
}

describe("generated word store", () => {
  it("loads a record from its generated shard", async () => {
    const root = await makeRoot();
    const bank = recordFor("bank");
    await writeFile(join(root, "words-03.json"), JSON.stringify({ bank }));

    const store = createGeneratedWordStore(root);

    await expect(store.get("bank")).resolves.toEqual(bank);
  });

  it("returns null for an invalid lemma without reading a shard", async () => {
    const root = await makeRoot();
    const read = vi.fn(async (path: string, encoding: "utf8") => readFile(path, encoding));
    const store = createGeneratedWordStore(root, read);

    await expect(store.get("../bank")).resolves.toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects an invalid generated record", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "words-03.json"), JSON.stringify({ bank: { lemma: "bank" } }));

    await expect(createGeneratedWordStore(root).get("bank")).rejects.toThrow("Invalid generated vocabulary record");
  });

  it("reads only the requested word shard", async () => {
    const root = await makeRoot();
    const bank = recordFor("bank");
    const bankPath = join(root, "words-03.json");
    await writeFile(bankPath, JSON.stringify({ bank }));
    await writeFile(join(root, "words-07.json"), "{not-json}");
    const read = vi.fn(async (path: string, encoding: "utf8") => readFile(path, encoding));

    await expect(createGeneratedWordStore(root, read).get("bank")).resolves.toEqual(bank);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(bankPath, "utf8");
  });
});
