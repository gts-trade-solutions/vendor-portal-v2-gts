import "server-only";
import { PrismaClient } from "@prisma/client";

// Single shared Prisma client (the one place the vendor app talks to MySQL).
// Cached on globalThis so Next.js dev hot-reload doesn't spawn a new pool per edit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
