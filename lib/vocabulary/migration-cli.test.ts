import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { migrateVocabularyCorpus } from "./migration-cli";

const bankPage = `---
lemma: bank
display: Bank
tier: core
pos: noun
lists: [ngsl]
rank: 1
sfi: 60
sources: [curated]
---

## Definition
A place that keeps money.

## Examples
- The bank is open. _(curated)_

## Connections
- collocation: [[money]] — money at a bank
`;

const learnPage = `---
lemma: learn
display: learn
tier: core
pos: verb
lists: [ngsl, academic]
rank: 2
sfi: 58
sources: [wordnet]
---

## Definition
To gain knowledge.

## Examples
- We learn every day. _(wordnet)_

## Connections
- builds_on: [[study]] — study helps you learn
`;

async function fixtureDirectories(): Promise<{ source: string; output: string }> {
  const root = await mkdtemp(join(tmpdir(), "vocabulary-migration-"));
  const source = join(root, "source");
  const output = join(root, "output");
  await mkdir(source);
  await writeFile(join(source, "bank.md"), bankPage, "utf8");
  await writeFile(join(source, "learn.md"), learnPage, "utf8");
  return { source, output };
}

async function directoryBytes(directory: string): Promise<Map<string, string>> {
  const names = (await readdir(directory)).sort();
  return new Map(await Promise.all(names.map(async (name) => [name, await readFile(join(directory, name), "utf8")] as const)));
}

describe("migrateVocabularyCorpus", () => {
  test("rejects a non-empty output directory unless force is set", async () => {
    const { source, output } = await fixtureDirectories();
    await mkdir(output);
    await writeFile(join(output, "keep.txt"), "keep", "utf8");

    await expect(migrateVocabularyCorpus({ sourceDirectory: source, outputDirectory: output, force: false }))
      .rejects.toThrow(`Refusing to overwrite non-empty output directory ${output}`);

    await expect(migrateVocabularyCorpus({ sourceDirectory: source, outputDirectory: output, force: true }))
      .resolves.toMatchObject({ totals: { records: 2, connections: 2 } });
    await expect(readdir(output)).resolves.not.toContain("keep.txt");
  });

  test("writes all shards and verified manifest artifacts for a small fixture", async () => {
    const { source, output } = await fixtureDirectories();
    const result = await migrateVocabularyCorpus({ sourceDirectory: source, outputDirectory: output, force: false });
    const names = await readdir(output);
    const shards = names.filter((name) => /^[0-1][0-9a-f]\.ndjson$/.test(name)).sort();
    const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")) as {
      totals: { records: number; connections: number; perList: Record<string, number> };
      shards: Record<string, { records: number; bytes: number; sha256: string }>;
    };

    expect(result.totals).toMatchObject({ records: 2, connections: 2, perList: { academic: 1, ngsl: 2 } });
    expect(shards).toHaveLength(32);
    expect(names).toEqual(expect.arrayContaining(["schema.json", "sources.json", "manifest.json"]));
    expect(manifest.totals).toEqual(result.totals);
    expect(Object.keys(manifest.shards).sort()).toEqual(shards.map((name) => name.slice(0, 2)));

    for (const shard of shards) {
      const bytes = await readFile(join(output, shard), "utf8");
      expect(manifest.shards[shard.slice(0, 2)]).toEqual({
        records: bytes.trimEnd() ? bytes.trimEnd().split("\n").length : 0,
        bytes: Buffer.byteLength(bytes),
        sha256: createHash("sha256").update(bytes, "utf8").digest("hex"),
      });
    }
  });

  test("is byte-identical on a second forced migration", async () => {
    const { source, output } = await fixtureDirectories();
    await migrateVocabularyCorpus({ sourceDirectory: source, outputDirectory: output, force: false });
    const first = await directoryBytes(output);

    await migrateVocabularyCorpus({ sourceDirectory: source, outputDirectory: output, force: true });

    await expect(directoryBytes(output)).resolves.toEqual(first);
  });
});
