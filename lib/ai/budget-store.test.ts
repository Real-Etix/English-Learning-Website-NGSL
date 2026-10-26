import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createBudgetStore } from "./budget-store";

const url = process.env.AI_TEST_DATABASE_URL;
// This suite never falls back to DATABASE_URL, dotenv, or a remote host.
if (url && (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname) || new URL(url).search)) throw new Error("Only a loopback test database without URL options is allowed");
const schema = `ai_test_${randomUUID().replaceAll("-", "")}`;
let admin: PrismaClient, db: PrismaClient;
const input = (extra = {}) => ({ id: randomUUID(), day: "2026-10-26", resetAt: new Date("2026-10-26T16:00:00Z"), visitor: randomUUID(), minute: "2026-10-26T12:00", amount: 100, cap: 1000, ...extra });

describe.skipIf(!url)("PostgreSQL budget store (isolated local schema)", () => {
  beforeAll(async () => {
    admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }, { schema }) });
    const sql = await readFile("prisma/runtime-ai-budget.sql", "utf8");
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      for (const statement of sql.split(";").map(s => s.trim()).filter(s => s && s !== "BEGIN" && s !== "COMMIT")) await tx.$executeRawUnsafe(statement);
    });
  }, 20000);
  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "${schema}"."AiRuntimeReservation", "${schema}"."AiRuntimeVisitor", "${schema}"."AiRuntimeDay"`);
  });
  afterAll(async () => {
    await db?.$disconnect();
    if (admin) { await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await admin.$disconnect(); }
  });
  const store = () => createBudgetStore(db, schema);
  it("admits only the last affordable reservations across concurrent requests", async () => {
    const results = await Promise.all(Array.from({ length: 15 }, () => store().reserve(input({ amount: 300 }))));
    expect(results.filter(r => r.ok)).toHaveLength(3);
  });
  it("shares per-visitor minute and day limits across route instances", async () => {
    const visitor = "same-visitor";
    const results = await Promise.all(Array.from({ length: 5 }, () => store().reserve(input({ visitor, amount: 1 }))));
    expect(results.filter(r => r.ok)).toHaveLength(3);
    for (let n = 0; n < 17; n++) expect((await store().reserve(input({ visitor, minute: String(n), amount: 1 }))).ok).toBe(true);
    expect(await store().reserve(input({ visitor, minute: "new", amount: 1 }))).toMatchObject({ ok: false, reason: "visitor-day" });
  });
  it("settles once and retains abandoned reservations", async () => {
    const request = input({ amount: 1000 });
    expect((await store().reserve(request)).ok).toBe(true);
    expect((await store().reserve(input())).ok).toBe(false);
    await Promise.all([store().settle(request.id, 200), store().settle(request.id, 200)]);
    expect((await store().reserve(input({ amount: 800 }))).ok).toBe(true);
    expect((await store().reserve(input({ amount: 1 }))).ok).toBe(false);
  });
  it("rejects duplicate IDs without dispatch admission", async () => {
    const request = input();
    expect((await store().reserve(request)).ok).toBe(true);
    expect((await store().reserve(request)).ok).toBe(false);
  });
  it("keeps late settlement on the original day and blocks globally on anomalies", async () => {
    const request = input({ amount: 1000 });
    await store().reserve(request);
    expect((await store().reserve(input({ day: "2026-10-27", amount: 1000 }))).ok).toBe(true);
    await store().settle(request.id, 1100);
    expect(await store().reserve(input({ day: "2026-10-28" }))).toMatchObject({ ok: false, reason: "unavailable" });
  });
});
