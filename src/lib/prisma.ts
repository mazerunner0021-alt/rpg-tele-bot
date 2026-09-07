import { PrismaClient } from "@prisma/client";

// Standard singleton pattern so `tsx watch` hot-reloads (and any future
// serverless-style reuse) don't exhaust the Neon connection pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
