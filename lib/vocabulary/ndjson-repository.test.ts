import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openNdjsonRepository, writeVocabularyRecords } from "./ndjson-repository";
import { shardIdForLemma } from "./shards";
import { vocabularyRecordFixture } from "./test-fixtures";
import type { VocabularyRecord } from "./schema";

function recordFor(lemma: string, listId = "ngsl"): VocabularyRecord {
  return {
    ...vocabularyRecordFixture(),
    lemma,
    display: lemma,
    lists: [{ id: listId, rank: 1, sfi: 50 }],
    connections: [],
  };
}

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ndjson-repository-"));
}

describe("NDJSON vocabulary repository", () => {
  test("gets one record and streams all records and list members", async () => {
    const root = await makeRoot();
    await mkdir(root, { recursive: true });
    const bank = recordFor("bank");
    const zebra = recordFor("zebra", "academic");
    await writeFile(
      join(root, `${shardIdForLemma(bank.lemma)}.ndjson`),
      `${JSON.stringify(zebra)}\n${JSON.stringify(bank)}\n`,
    );
    await writeFile(
      join(root, `${shardIdForLemma(zebra.lemma)}.ndjson`),
      `${JSON.stringify(zebra)}\n`,
    );

    const repository = openNdjsonRepository(root);

    expect((await repository.get("bank"))?.display).toBe("bank");
    expect(await collect(repository.all())).toEqual(
      expect.arrayContaining([expect.objectContaining({ lemma: "bank" })]),
    );
    expect((await collect(repository.list("ngsl"))).map((word) => word.lemma)).toContain("bank");
  });

  test("writes sorted, newline-terminated shards atomically and skips identical writes", async () => {
    const root = await makeRoot();
    const bank = recordFor("bank");
    const zebra = recordFor("zebra");

    const changed = await writeVocabularyRecords(root, [zebra, bank]);
    expect(changed).toEqual([...new Set([shardIdForLemma("bank"), shardIdForLemma("zebra")])].sort());

    for (const shardId of changed) {
      const bytes = await readFile(join(root, `${shardId}.ndjson`), "utf8");
      expect(bytes.endsWith("\n")).toBe(true);
      const records = bytes.trimEnd().split("\n").map((line) => JSON.parse(line) as VocabularyRecord);
      expect(records.map((record) => record.lemma)).toEqual(
        [...records].sort((left, right) => left.lemma < right.lemma ? -1 : left.lemma > right.lemma ? 1 : 0).map((record) => record.lemma),
      );
      expect(collect(openNdjsonRepository(root).all())).resolves.toEqual(
        expect.arrayContaining(records.map((record) => expect.objectContaining({ lemma: record.lemma }))),
      );
    }

    expect(await writeVocabularyRecords(root, [zebra, bank])).toEqual([]);
  });

  test("rejects duplicate update lemmas", async () => {
    const root = await makeRoot();

    await expect(writeVocabularyRecords(root, [recordFor("bank"), recordFor("bank")])).rejects.toThrow(
      "Duplicate vocabulary update lemma: bank",
    );
  });
});

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}
