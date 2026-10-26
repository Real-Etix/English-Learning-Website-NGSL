import { describe, expect, it, vi } from "vitest";
import { activationAllowed, applyBudgetSchema } from "./activate-runtime-ai-budget";
import { readFileSync } from "node:fs";

const sha = "a".repeat(40);
const now = new Date("2026-10-26T10:00:00Z");
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  VERCEL: "1", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: sha,
  VERCEL_PROJECT_ID: "prj_ml9GrecZRTW68XfvYBuPhZATsNdd",
  VERCEL_GIT_REPO_OWNER: "Real-Etix", VERCEL_GIT_REPO_SLUG: "English-Learning-Website-NGSL",
  VERCEL_GIT_COMMIT_REF: "cursor/ngsl-mood-trainer",
  DATABASE_URL: "postgresql://test:dummy@ep-test.neon.tech/test?sslmode=require",
  LLM_API_KEY: "test-key", LLM_BASE_URL: "https://api.deepseek.com/v1", LLM_MODEL: "deepseek-v4-flash",
  AI_RUNTIME_ENABLED: "true", AI_RUNTIME_DAILY_MICRO_CNY: "1000000",
  AI_RUNTIME_PRICE_POLICY: "deepseek-flash-2026-10-26", AI_RUNTIME_HMAC_SECRET: "x".repeat(64),
};
const sql = readFileSync("prisma/runtime-ai-budget.sql", "utf8");

describe("one-off production activation boundary", () => {
  it("allows only the approved production commit with valid runtime policy", () => {
    expect(activationAllowed(env, sha, now)).toBe(true);
  });
  it.each([{ VERCEL: "" }, { VERCEL_ENV: "preview" }, { VERCEL_GIT_COMMIT_SHA: "b".repeat(40) }])("skips unrelated builds: %j", change => {
    expect(activationAllowed({ ...env, ...change }, sha, now)).toBe(false);
  });
  it.each([
    { VERCEL_PROJECT_ID: "another-project" }, { VERCEL_GIT_REPO_OWNER: "someone" },
    { VERCEL_GIT_REPO_SLUG: "another-repo" }, { VERCEL_GIT_COMMIT_REF: "main" },
    { DATABASE_URL: "postgresql://test:dummy@localhost/test" },
    { DATABASE_URL: "postgresql://test:dummy@ep-test.neon.tech.attacker.example/test" },
    { DATABASE_URL: "postgresql://test:dummy@ep-test.neon.tech/test?schema=other" },
    { DATABASE_URL: "postgresql://test:dummy@ep-test.neon.tech/test?options=-c%20search_path%3Dother" },
    { DATABASE_URL: "not a URL" }, { LLM_API_KEY: "" }, { LLM_MODEL: "unpriced-model" },
    { AI_RUNTIME_ENABLED: "false" }, { AI_RUNTIME_HMAC_SECRET: "short" },
  ])("rejects unsafe configuration before connecting: %j", change => {
    expect(() => activationAllowed({ ...env, ...change }, sha, now)).toThrow();
  });
  it("rejects unpinned and expired activation", () => {
    expect(() => activationAllowed(env, "latest", now)).toThrow();
    expect(() => activationAllowed(env, sha, new Date("2026-11-25T00:00:00Z"))).toThrow();
  });
});

describe("additive schema setup inside its caller's transaction", () => {
  const columns = [
    ["AiRuntimeDay", "day", "text"], ["AiRuntimeDay", "cap", "integer"],
    ["AiRuntimeDay", "charged", "integer"], ["AiRuntimeDay", "anomaly", "boolean"],
    ["AiRuntimeVisitor", "id", "text"], ["AiRuntimeVisitor", "count", "integer"],
    ["AiRuntimeVisitor", "minute", "text"], ["AiRuntimeVisitor", "minuteCount", "integer"],
    ["AiRuntimeReservation", "id", "text"], ["AiRuntimeReservation", "day", "text"],
    ["AiRuntimeReservation", "amount", "integer"], ["AiRuntimeReservation", "actual", "integer"],
    ["AiRuntimeReservation", "createdAt", "timestamp with time zone"],
  ].map(([table_name, column_name, data_type]) => ({ table_name, column_name, data_type }));
  function fixture() {
    const executed: string[] = [];
    const query = vi.fn(async (s: string): Promise<Record<string, unknown>[]> => {
      if (s.includes("to_regclass")) return [{ collection: true, collected: true }];
      if (s.includes("information_schema.columns")) return columns;
      if (s.includes("pg_constraint")) return [{ valid: true }];
      if (s.includes("pg_indexes")) return [{ valid: true }];
      if (s.includes("anomaly")) return [{ healthy: true }];
      throw new Error("Unexpected query");
    });
    return { executed, query, execute: async (s: string) => { executed.push(s); } };
  }
  it("applies only the four reviewed CREATE statements and validates metadata", async () => {
    const db = fixture();
    await applyBudgetSchema(db, sql);
    expect(db.executed).toHaveLength(4);
    expect(db.executed.every(s => /^CREATE (TABLE|INDEX) IF NOT EXISTS/.test(s))).toBe(true);
    expect(db.query.mock.calls[0][0]).toContain("to_regclass");
    expect(db.query).toHaveBeenCalledTimes(5);
  });
  it("refuses a database without the application's existing tables", async () => {
    const db = fixture(); db.query.mockResolvedValueOnce([{ collection: false, collected: false }]);
    await expect(applyBudgetSchema(db, sql)).rejects.toThrow("learning tables");
    expect(db.executed).toHaveLength(0);
  });
  it("rejects unrelated or destructive SQL before executing it", async () => {
    const db = fixture();
    await expect(applyBudgetSchema(db, sql.replace('CREATE TABLE IF NOT EXISTS "AiRuntimeDay"', 'CREATE TABLE IF NOT EXISTS "SomethingElse"'))).rejects.toThrow("SQL");
    await expect(applyBudgetSchema(db, sql + '\nDROP TABLE "Collection";')).rejects.toThrow("SQL");
    expect(db.executed).toHaveLength(0);
  });
  it("fails validation instead of silently accepting an incompatible table", async () => {
    const db = fixture(); db.query.mockResolvedValueOnce([{ collection: true, collected: true }]).mockResolvedValueOnce(columns.slice(1));
    await expect(applyBudgetSchema(db, sql)).rejects.toThrow("columns");
  });
  it("preserves and refuses existing accounting anomalies", async () => {
    const db = fixture();
    db.query.mockImplementation(async s => s.includes("anomaly") ? [{ healthy: false }] : s.includes("information_schema.columns") ? columns : s.includes("to_regclass") ? [{ collection: true, collected: true }] : [{ valid: true }]);
    await expect(applyBudgetSchema(db, sql)).rejects.toThrow("anomaly");
    expect(db.executed.every(s => !/DELETE|UPDATE|TRUNCATE/.test(s))).toBe(true);
  });
});
