import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { readBounded, RecoveryCache, acquireRecoveryLock, attributableTatoeba } from "./recovery-io";

test("bounds streamed bytes, not only an advertised content length", async () => {
  await expect(readBounded(new Response("abcd"), 3)).rejects.toThrow("limit");
  expect(await readBounded(new Response("abc"), 3)).toBe("abc");
});
test("cache reuses data across restarts and enforces its persisted size ceiling", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "recovery-cache-test-"));
  try {
    const cache = new RecoveryCache(root, 200);
    await cache.save("test", { value: "abc" });
    expect(await new RecoveryCache(root, 200).load("test")).toEqual({ value: "abc" });
    await expect(cache.save("large", { value: "x".repeat(300) })).rejects.toThrow("limit");
  } finally { await rm(root, { recursive: true }); }
});
test("refuses a duplicate live worker and releases its own lock", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "recovery-lock-test-"));
  try {
    const release = await acquireRecoveryLock(root);
    await expect(acquireRecoveryLock(root)).rejects.toThrow("active");
    await release();
    await (await acquireRecoveryLock(root))();
  } finally { await rm(root, { recursive: true }); }
});
test("does not invent sentence attribution or licensing", () => {
  const row = { id: 42, text: "We learn today.", lang: "eng", user: { username: "ExampleAuthor" }, license: "CC BY 2.0 FR" };
  expect(attributableTatoeba({ data: [row] }, "learn", ["learn"], "2026-10-13T00:00:00.000Z")[0]?.sources[0]).toMatchObject({ attribution: "ExampleAuthor", license: "CC BY 2.0 FR" });
  expect(attributableTatoeba({ data: [{ ...row, user: null }, { ...row, license: undefined }] }, "learn", ["learn"], "2026-10-13T00:00:00.000Z")).toEqual([]);
});
test("accepts the actual API owner field and rejects unapproved sentences", () => {
  const row = { id: 42, text: "We learn today.", lang: "eng", owner: "ExampleAuthor", license: "CC BY 2.0 FR", is_unapproved: false };
  expect(attributableTatoeba({ data: [row] }, "learn", [], "2026-10-13T00:00:00.000Z")[0]?.sources[0]?.attribution).toBe("ExampleAuthor");
  expect(attributableTatoeba({ data: [{ ...row, is_unapproved: true }] }, "learn", [], "2026-10-13T00:00:00.000Z")).toEqual([]);
});
test("caches a real absence, rejects invalid JSON and reuses a successful entry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "recovery-http-test-"));
  try {
    const cache = new RecoveryCache(root);
    const request = vi.spyOn(cache, "request");
    request.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    expect(await cache.englishEntries("absent")).toEqual([]);
    expect(await cache.englishEntries("absent")).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValueOnce(new Response("not-json"));
    await expect(cache.englishEntries("malformed")).rejects.toThrow();
    request.mockResolvedValueOnce(new Response(JSON.stringify({ word: "word", lang_code: "en" }) + "\n"));
    expect(await cache.englishEntries("word")).toEqual([{ word: "word", lang_code: "en" }]);
    expect(await new RecoveryCache(root).englishEntries("word")).toEqual([{ word: "word", lang_code: "en" }]);
  } finally { await rm(root, { recursive: true }); }
});
test("skips malformed Tatoeba rows without discarding valid evidence", () => {
  const row = { id: 42, text: "We learn today.", lang: "eng", owner: "ExampleAuthor", license: "CC BY 2.0 FR" };
  expect(attributableTatoeba({ data: [null, "invalid", row] }, "learn", [], "2026-10-13T00:00:00.000Z")).toHaveLength(1);
});
