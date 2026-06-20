import { PrismaClient } from '@prisma/client';

// PrismaClient 单例:挂 globalThis 避免 Next.js dev 热重载时重复 new 触发连接池告警。
// 和 runtime-state.ts 同一个坑。
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}
