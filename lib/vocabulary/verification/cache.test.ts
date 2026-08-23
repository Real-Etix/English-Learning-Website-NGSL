import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";

import {
  canonicalVerificationJson,
  createVerificationCache,
  readVerificationCache,
  verificationCacheKey,
  writeVerificationCache,
} from "./cache";

const EvidenceSchema = z.object({
  provider: z.literal("dictionaryapi"),
  returnedLemma: z.string(),
  requestedPartOfSpeech: z.string(),
});

const evidence = {
  provider: "dictionaryapi" as const,
  returnedLemma: "manifest",
  requestedPartOfSpeech: "verb",
};

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function cacheRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vocabulary-verification-cache-"));
  roots.push(root);
  return root;
}

describe("canonicalVerificationJson", () => {
  test("sorts object keys recursively without changing array order", () => {
    expect(canonicalVerificationJson({
      z: 0,
      nested: [{ z: 2, a: 1 }, { a: 3 }],
      a: { z: 1, b: 2 },
    })).toBe('{"a":{"b":2,"z":1},"nested":[{"a":1,"z":2},{"a":3}],"z":0}');
  });
});

describe("verificationCacheKey", () => {
  test("is independent of request key order and changes with provider inputs", () => {
    const first = verificationCacheKey({
      provider: "dictionaryapi",
      version: "v1",
      request: { lemma: "manifest", pos: "verb" },
      model: "deepseek-chat",
      promptVersion: "prompt-v1",
    });
    const reordered = verificationCacheKey({
      provider: "dictionaryapi",
      version: "v1",
      request: { pos: "verb", lemma: "manifest" },
      model: "deepseek-chat",
      promptVersion: "prompt-v1",
    });

    expect(first).toBe(reordered);
    expect(first).not.toBe(verificationCacheKey({
      provider: "wordnet",
      version: "v1",
      request: { lemma: "manifest", pos: "verb" },
      model: "deepseek-chat",
      promptVersion: "prompt-v1",
    }));
    expect(first).not.toBe(verificationCacheKey({
      provider: "dictionaryapi",
      version: "v2",
      request: { lemma: "manifest", pos: "verb" },
      model: "deepseek-chat",
      promptVersion: "prompt-v1",
    }));
    expect(first).not.toBe(verificationCacheKey({
      provider: "dictionaryapi",
      version: "v1",
      request: { lemma: "scrutinize", pos: "verb" },
      model: "deepseek-chat",
      promptVersion: "prompt-v1",
    }));
    expect(first).not.toBe(verificationCacheKey({
      provider: "dictionaryapi",
      version: "v1",
      request: { lemma: "manifest", pos: "verb" },
      model: "deepseek-reasoner",
      promptVersion: "prompt-v1",
    }));
    expect(first).not.toBe(verificationCacheKey({
      provider: "dictionaryapi",
      version: "v1",
      request: { lemma: "manifest", pos: "verb" },
      model: "deepseek-chat",
      promptVersion: "prompt-v2",
    }));
  });

  test("does not expose request secrets in the returned key", () => {
    const key = verificationCacheKey({
      provider: "dictionaryapi",
      version: "v1",
      request: {
        lemma: "manifest",
        headers: { authorization: "Bearer super-secret" },
        prompt: "raw prompt must not be persisted",
      },
    });

    expect(key).not.toContain("super-secret");
    expect(key).not.toContain("raw prompt");
  });
});

describe("verification cache I/O", () => {
  test("writes and reads a schema-validated value under its provider namespace", async () => {
    const root = await cacheRoot();
    const key = verificationCacheKey({
      provider: "dictionaryapi",
      version: "v1",
      request: { lemma: "manifest", pos: "verb" },
    });

    await writeVerificationCache(root, key, evidence, EvidenceSchema);

    expect(await readVerificationCache(root, key, EvidenceSchema)).toEqual(evidence);
    expect(await readdir(join(root, "dictionaryapi"))).toHaveLength(1);
  });

  test("treats invalid and truncated entries as cache misses", async () => {
    const root = await cacheRoot();
    const key = verificationCacheKey({
      provider: "dictionaryapi",
      version: "v1",
      request: { lemma: "manifest", pos: "verb" },
    });
    await writeVerificationCache(root, key, evidence, EvidenceSchema);

    const providerRoot = join(root, "dictionaryapi");
    const [filename] = await readdir(providerRoot);
    const entry = join(providerRoot, filename!);

    await writeFile(entry, "{\"provider\":\"dictionaryapi\"", "utf8");
    expect(await readVerificationCache(root, key, EvidenceSchema)).toBeNull();

    await writeFile(entry, JSON.stringify({ ...evidence, provider: "wordnet" }), "utf8");
    expect(await readVerificationCache(root, key, EvidenceSchema)).toBeNull();
  });

  test("atomically replaces an existing entry without leaving temporary files", async () => {
    const root = await cacheRoot();
    const key = verificationCacheKey({
      provider: "dictionaryapi",
      version: "v1",
      request: { lemma: "manifest", pos: "verb" },
    });

    await writeVerificationCache(root, key, evidence, EvidenceSchema);
    await writeVerificationCache(root, key, { ...evidence, returnedLemma: "scrutinize" }, EvidenceSchema);

    expect(await readVerificationCache(root, key, EvidenceSchema)).toEqual({
      ...evidence,
      returnedLemma: "scrutinize",
    });
    expect((await readdir(join(root, "dictionaryapi"))).filter((name) => name.includes("tmp"))).toEqual([]);
  });

  test("supports the typed orchestrator wrapper without storing request metadata", async () => {
    const root = await cacheRoot();
    const cache = createVerificationCache(root);
    const key = verificationCacheKey({
      provider: "dictionaryapi",
      version: "v1",
      request: { lemma: "manifest", headers: { authorization: "Bearer secret" } },
    });

    await cache.set("dictionaryapi", key, evidence, EvidenceSchema);

    expect(await cache.get("dictionaryapi", key, EvidenceSchema)).toEqual(evidence);
    const [filename] = await readdir(join(root, "dictionaryapi"));
    const stored = await readFile(join(root, "dictionaryapi", filename!), "utf8");
    expect(stored).toBe(JSON.stringify(evidence));
    expect(stored).not.toContain("authorization");
    expect(stored).not.toContain("secret");
  });
});
