import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runtimePolicy } from "../lib/ai/policy";

// Intentionally no dotenv: secrets must remain in the existing Vercel environment.
export function activationAllowed(env: NodeJS.ProcessEnv, expectedSha: string, now: Date): boolean {
  if (!/^[a-f0-9]{40}$/.test(expectedSha)) throw new Error("Activation requires an exact commit SHA");
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "production" || env.VERCEL_GIT_COMMIT_SHA !== expectedSha) return false;
  if (env.VERCEL_PROJECT_ID !== "prj_ml9GrecZRTW68XfvYBuPhZATsNdd" ||
    env.VERCEL_GIT_REPO_OWNER !== "Real-Etix" || env.VERCEL_GIT_REPO_SLUG !== "English-Learning-Website-NGSL" ||
    env.VERCEL_GIT_COMMIT_REF !== "cursor/ngsl-mood-trainer") throw new Error("Activation project identity mismatch");
  if (!runtimePolicy(env, now)) throw new Error("Activation runtime configuration is unavailable or expired");
  let url: URL;
  try { url = new URL(env.DATABASE_URL!); } catch { throw new Error("Activation database URL is invalid"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".neon.tech") ||
    !url.username || !url.password || !url.pathname.slice(1) ||
    (url.searchParams.has("schema") && url.searchParams.get("schema") !== "public") || url.searchParams.has("options")) {
    throw new Error("Activation requires the existing Neon public schema");
  }
  return true;
}

type SqlSession = {
  query(sql: string): Promise<Record<string, unknown>[]>;
  execute(sql: string): Promise<void>;
};

/** Caller supplies one bounded transaction. A failed validation rolls back all DDL. */
export async function applyBudgetSchema(db: SqlSession, sql: string): Promise<void> {
  // Pin the reviewed migration, not arbitrary SQL passed through deployment settings.
  if (createHash("sha256").update(sql).digest("hex") !== "907c459b8abc1a63e2185427c270a2fccd0145759230241ea561d479253d30b4") {
    throw new Error("Activation SQL differs from the reviewed migration");
  }
  const [existing] = await db.query(`SELECT to_regclass('public."Collection"') IS NOT NULL AS collection,
    to_regclass('public."CollectedWord"') IS NOT NULL AS collected`);
  if (!existing?.collection || !existing?.collected) throw new Error("Existing learning tables not found");
  const statements = sql.split(";").map(s => s.trim()).filter(s => s && s !== "BEGIN" && s !== "COMMIT");
  for (const statement of statements) await db.execute(statement);

  const columns = await db.query(`SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('AiRuntimeDay', 'AiRuntimeVisitor', 'AiRuntimeReservation')`);
  const expected = [
    "AiRuntimeDay.day.text", "AiRuntimeDay.cap.integer", "AiRuntimeDay.charged.integer", "AiRuntimeDay.anomaly.boolean",
    "AiRuntimeVisitor.id.text", "AiRuntimeVisitor.count.integer", "AiRuntimeVisitor.minute.text", "AiRuntimeVisitor.minuteCount.integer",
    "AiRuntimeReservation.id.text", "AiRuntimeReservation.day.text", "AiRuntimeReservation.amount.integer",
    "AiRuntimeReservation.actual.integer", "AiRuntimeReservation.createdAt.timestamp with time zone",
  ].sort();
  const actual = columns.map(c => `${c.table_name}.${c.column_name}.${c.data_type}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Accounting columns do not match");
  const [constraints] = await db.query(`SELECT
    count(*) FILTER (WHERE contype = 'p') = 3 AND
    count(*) FILTER (WHERE contype = 'c' AND convalidated) = 4 AND
    count(*) FILTER (WHERE contype = 'f' AND convalidated AND conrelid = 'public."AiRuntimeReservation"'::regclass
      AND confrelid = 'public."AiRuntimeDay"'::regclass) = 1 AS valid
    FROM pg_constraint WHERE conrelid IN ('public."AiRuntimeDay"'::regclass,
      'public."AiRuntimeVisitor"'::regclass, 'public."AiRuntimeReservation"'::regclass)`);
  if (!constraints?.valid) throw new Error("Accounting constraints do not match");
  const [index] = await db.query(`SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
    AND tablename = 'AiRuntimeReservation' AND indexname = 'AiRuntimeReservation_day_idx') AS valid`);
  if (!index?.valid) throw new Error("Accounting index not found");
  const [health] = await db.query(`SELECT NOT EXISTS (SELECT 1 FROM public."AiRuntimeDay" WHERE anomaly) AS healthy`);
  if (!health?.healthy) throw new Error("Existing accounting anomaly requires investigation");
}

async function main() {
  const expectedSha = process.argv[2] ?? "";
  if (process.argv.length !== 3) throw new Error("Pass exactly the approved commit SHA");
  if (!activationAllowed(process.env, expectedSha, new Date())) {
    console.log("RUNTIME_AI_ACTIVATION_SKIPPED: not the approved production commit");
    return;
  }
  console.log("RUNTIME_AI_CONFIG_VERIFIED: production, supported provider, cap <= 1 CNY/day");
  const sql = await readFile(path.resolve("prisma/runtime-ai-budget.sql"), "utf8");
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 }), log: [] });
  try {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL search_path = public");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '15000ms'");
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5000ms'");
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(73521, 1)::text`;
      await applyBudgetSchema({
        query: sql => tx.$queryRawUnsafe<Record<string, unknown>[]>(sql),
        execute: async sql => { await tx.$executeRawUnsafe(sql); },
      }, sql);
    }, { maxWait: 15000, timeout: 60000 });
    console.log("RUNTIME_AI_SCHEMA_VERIFIED: 3 accounting tables, 13 columns, constraints/index valid, existing rows preserved");
  } finally { await db.$disconnect(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Do not emit raw Prisma/connection errors, which may contain credentials.
    console.error("RUNTIME_AI_ACTIVATION_FAILED: configuration or database validation failed; deployment stopped; no secrets logged");
    process.exitCode = 1;
  });
}
