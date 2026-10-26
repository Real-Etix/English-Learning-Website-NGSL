BEGIN;
CREATE TABLE IF NOT EXISTS "AiRuntimeDay" (
  "day" TEXT PRIMARY KEY,
  "cap" INTEGER NOT NULL CHECK ("cap" > 0 AND "cap" <= 1000000),
  "charged" INTEGER NOT NULL DEFAULT 0 CHECK ("charged" >= 0),
  "anomaly" BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS "AiRuntimeVisitor" (
  "id" TEXT PRIMARY KEY,
  "count" INTEGER NOT NULL,
  "minute" TEXT NOT NULL,
  "minuteCount" INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS "AiRuntimeReservation" (
  "id" TEXT PRIMARY KEY,
  "day" TEXT NOT NULL REFERENCES "AiRuntimeDay"("day"),
  "amount" INTEGER NOT NULL CHECK ("amount" > 0),
  "actual" INTEGER CHECK ("actual" >= 0),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AiRuntimeReservation_day_idx" ON "AiRuntimeReservation"("day");
COMMIT;
