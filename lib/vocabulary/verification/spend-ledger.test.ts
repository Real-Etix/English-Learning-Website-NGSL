import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { SpendLedger, worstCaseMicroCny } from "./spend-ledger";

test("reserves before sending, survives restart and never refunds unknown failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "vocab-ledger-"));
  try {
    const path = join(root, "ledger.json");
    const first = new SpendLedger(path, 0.01);
    expect(first.reserve("a", 6000)).toBe(true);
    expect(first.reserve("a", 6000)).toBe(false);
    const resumed = new SpendLedger(path, 0.01);
    expect(resumed.reserve("b", 5000)).toBe(false);
    expect(resumed.chargedMicroCny).toBe(6000);
    resumed.finish("a", { inputTokens: 500, outputTokens: 100 }, { sense: 0, example: 0 });
    expect(resumed.chargedMicroCny).toBe(1800);
    expect(new SpendLedger(path, 0.01).entry("a")?.value).toEqual({ sense: 0, example: 0 });
    expect(resumed.reserve("b", 5000)).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cannot raise a saved ceiling or accept invalid reservations", async () => {
  const root = await mkdtemp(join(tmpdir(), "vocab-ledger-"));
  try {
    const path = join(root, "ledger.json");
    const ledger = new SpendLedger(path, 1);
    expect(() => ledger.reserve("x", -1)).toThrow();
    ledger.reserve("x", 100);
    expect(() => new SpendLedger(path, 2)).toThrow();
    expect(worstCaseMicroCny("hello", 64)).toBeGreaterThanOrEqual(5 * 2 + 64 * 8);
  } finally { await rm(root, { recursive: true, force: true }); }
});
