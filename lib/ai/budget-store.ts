import { Prisma, type PrismaClient } from "@prisma/client";

export type Reservation = { id: string; day: string; resetAt: Date; visitor: string; minute: string; amount: number; cap: number };
export type Admission = { ok: true } | { ok: false; reason: "budget" | "visitor-minute" | "visitor-day" | "unavailable" };
export interface BudgetStore {
  reserve(input: Reservation): Promise<Admission>;
  settle(id: string, actualCost: number): Promise<void>;
}

/** All instances coordinate in PostgreSQL, never in process memory. */
export function createBudgetStore(db: Pick<PrismaClient, "$transaction">, schema = "public"): BudgetStore {
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error("Invalid accounting schema");
  const dayTable = Prisma.raw(`"${schema}"."AiRuntimeDay"`);
  const visitorTable = Prisma.raw(`"${schema}"."AiRuntimeVisitor"`);
  const reservationTable = Prisma.raw(`"${schema}"."AiRuntimeReservation"`);
  const transaction = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(async tx => {
    // A short transaction-wide lock also serializes late settlement across midnight.
    // Never hold this lock during a provider call. Statement timeout bounds lock waits.
    await tx.$executeRaw`SET LOCAL statement_timeout = '4000ms'`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(73521, 1)::text`;
    return fn(tx);
  }, { maxWait: 5000, timeout: 10000 });
  return {
    reserve(input) {
      return transaction(async tx => {
        if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > input.cap || input.cap > 1_000_000) return { ok: false, reason: "budget" };
        const anomaly = await tx.$queryRaw<{ day: string }[]>(Prisma.sql`SELECT day FROM ${dayTable} WHERE anomaly = true LIMIT 1`);
        if (anomaly.length) return { ok: false, reason: "unavailable" };
        const duplicate = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM ${reservationTable} WHERE id = ${input.id}`);
        if (duplicate.length) return { ok: false, reason: "unavailable" };
        await tx.$executeRaw(Prisma.sql`INSERT INTO ${dayTable} (day, cap, charged, anomaly) VALUES (${input.day}, ${input.cap}, 0, false) ON CONFLICT (day) DO UPDATE SET cap = LEAST(${dayTable}.cap, EXCLUDED.cap)`);
        const [day] = await tx.$queryRaw<{ cap: number; charged: number }[]>(Prisma.sql`SELECT cap, charged FROM ${dayTable} WHERE day = ${input.day}`);
        if (!day || day.charged + input.amount > day.cap) return { ok: false, reason: "budget" };
        const visitorId = `${input.day}:${input.visitor}`;
        const [visitor] = await tx.$queryRaw<{ count: number; minute: string; minuteCount: number }[]>(Prisma.sql`SELECT count, minute, "minuteCount" FROM ${visitorTable} WHERE id = ${visitorId}`);
        if (visitor && visitor.count >= 20) return { ok: false, reason: "visitor-day" };
        if (visitor?.minute === input.minute && visitor.minuteCount >= 3) return { ok: false, reason: "visitor-minute" };
        await tx.$executeRaw(Prisma.sql`INSERT INTO ${visitorTable} (id, count, minute, "minuteCount") VALUES (${visitorId}, 1, ${input.minute}, 1)
          ON CONFLICT (id) DO UPDATE SET count = ${visitorTable}.count + 1, minute = EXCLUDED.minute,
          "minuteCount" = CASE WHEN ${visitorTable}.minute = EXCLUDED.minute THEN ${visitorTable}."minuteCount" + 1 ELSE 1 END`);
        await tx.$executeRaw(Prisma.sql`INSERT INTO ${reservationTable} (id, day, amount) VALUES (${input.id}, ${input.day}, ${input.amount})`);
        await tx.$executeRaw(Prisma.sql`UPDATE ${dayTable} SET charged = charged + ${input.amount} WHERE day = ${input.day}`);
        return { ok: true };
      });
    },
    settle(id, actualCost) {
      return transaction(async tx => {
        if (!Number.isSafeInteger(actualCost) || actualCost < 0 || actualCost > 1_000_000_000) throw new Error("Invalid usage cost");
        const [reservation] = await tx.$queryRaw<{ day: string; amount: number; actual: number | null }[]>(Prisma.sql`SELECT day, amount, actual FROM ${reservationTable} WHERE id = ${id}`);
        if (!reservation) throw new Error("Reservation unavailable");
        if (reservation.actual !== null) return;
        await tx.$executeRaw(Prisma.sql`UPDATE ${reservationTable} SET actual = ${actualCost} WHERE id = ${id}`);
        await tx.$executeRaw(Prisma.sql`UPDATE ${dayTable} SET charged = charged + ${actualCost - reservation.amount}, anomaly = anomaly OR ${actualCost > reservation.amount} WHERE day = ${reservation.day}`);
      });
    },
  };
}
