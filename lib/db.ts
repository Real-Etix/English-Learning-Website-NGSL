import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Prisma 7 connects via a driver adapter (no runtime `url` option); the schema's
// datasource has no url, so we pass the connection string to the pg adapter here.
const url =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/ngsl_mood_trainer";

// Singleton so dev HMR doesn't open a new connection pool on every reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
