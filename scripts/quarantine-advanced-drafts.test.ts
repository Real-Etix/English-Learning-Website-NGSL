import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runQuarantineAdvancedDrafts } from "./quarantine-advanced-drafts";
import { vocabularyRecordFixture } from "../lib/vocabulary/test-fixtures";
import { shardIdForLemma } from "../lib/vocabulary/shards";

const sourceRef = (sourceId: string) => ({ sourceId, externalId: null, url: null, retrievedAt: null, contentHash: null });

describe("quarantine advanced drafts", () => {
  it("reports without mutation, then atomically hides unsupported advanced records exactly once", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "quarantine-advanced-"));
    const core = vocabularyRecordFixture();
    const advanced = {
      ...vocabularyRecordFixture(),
      lemma: "master",
      display: "master",
      tier: "advanced" as const,
      status: "enriched" as const,
      sources: [sourceRef("llm")],
      senses: [{
        ...vocabularyRecordFixture().senses[0],
        sources: [sourceRef("llm")],
        examples: [{ text: "She mastered the material.", sources: [sourceRef("llm")] }],
      }],
      connections: [{
        ...vocabularyRecordFixture().connections[0],
        target: core.lemma,
        type: "builds_on" as const,
        gloss: "Builds on the core verb.",
        status: "published" as const,
      }],
    };
    const shard = shardIdForLemma(advanced.lemma);
    const file = path.join(root, `${shard}.ndjson`);
    await writeFile(file, `${JSON.stringify(advanced)}\n`, "utf8");

    const dryRun = await runQuarantineAdvancedDrafts({ root, write: false });
    expect(dryRun).toMatchObject({ total: 1, changes: 1, byList: { ngsl: 1 }, lemmas: [advanced.lemma] });
    expect(JSON.parse((await readFile(file, "utf8")).trim()).publicationStatus).toBe("published");

    const firstWrite = await runQuarantineAdvancedDrafts({ root, write: true });
    expect(firstWrite.changes).toBe(1);
    expect(firstWrite.changedShards).toEqual([shard]);
    expect(JSON.parse((await readFile(file, "utf8")).trim()).publicationStatus).toBe("hidden");

    await expect(runQuarantineAdvancedDrafts({ root, write: true })).resolves.toMatchObject({ total: 1, changes: 0, changedShards: [] });
  });
});
