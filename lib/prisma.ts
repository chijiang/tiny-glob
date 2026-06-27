import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/lib/generated/prisma/client';

// PrismaClient 单例:挂 globalThis 避免 Next.js dev 热重载时重复 new 触发连接池告警。
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// ===== Neon 抖动兜底 =====
// 此开发环境连 Neon pooler 偶发抖动(Prisma 标为 P1001 / pg 层 "Connection terminated
// unexpectedly")。raw pg 遇到空闲断开会自动重连,但 Prisma 驱动适配器把每次抖动都直接
// 抛成 500。这里三层处理,与 LLM 的三次重试保持一致:
//  1) 显式 pg.Pool(Neon 友好的超时/上限)替代适配器内部默认池,行为更确定;
//  2) pool.on('error') 记录空闲连接断开的精确错误,便于下次定位 code/syscall;
//  3) $extends 查询中间件对"连接类"错误最多重试 3 次后才抛——让间歇性网络抖动不再直接 500。
const MAX_DB_ATTEMPTS = 3;
const DB_RETRY_BASE_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 仅连接类错误重试;业务错误(唯一约束/校验/未找到等)立即抛出。 */
function isTransientDbError(e: unknown): boolean {
  if (e == null) return false;
  const code = (e as { code?: string }).code;
  // Prisma 连接类:无法连接 / 已断开 / 连接超时
  if (code === 'P1001' || code === 'P1002' || code === 'P1008') return true;
  const name = (e as { name?: string }).name ?? '';
  const msg = (e as { message?: string }).message ?? '';
  const text = `${name} ${msg}`.toLowerCase();
  return /connection terminated|connection closed|econnreset|etimedout|enotfound|eai_again|socket hang up|timeout|fetch failed/.test(
    text,
  );
}

function createPrismaClient(): PrismaClient {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5, // serverless 友好,避免开太多连接
    connectionTimeoutMillis: 15000, // 建连超 15s 判失败(而非无限挂起)
    idleTimeoutMillis: 10000, // 空闲 10s 收回,先于 Neon 关闭服务端连接
  });
  // 池中空闲连接被 Neon 关闭时会异步触发,记录精确错误便于诊断(不影响后续重连)。
  pool.on('error', (err) => {
    const e = err as Error & { code?: string };
    console.error('[prisma pool]', e.code ?? e.name, e.message);
  });

  const base = new PrismaClient({
    adapter: new PrismaPg(pool),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  // 注意:对写操作(create/update/...)的重试仅在"连接建立阶段就断开"时发生,几乎不会
  // 重复写入;若真在写入提交后断开,唯一约束会兜住(create 抛 P2002,upsert 幂等)。
  return base.$extends({
    query: {
      async $allOperations({ operation, query, args }) {
        for (let attempt = 1; attempt <= MAX_DB_ATTEMPTS; attempt++) {
          try {
            return await query(args);
          } catch (e) {
            if (attempt === MAX_DB_ATTEMPTS || !isTransientDbError(e)) throw e;
            console.warn(
              `[prisma retry] ${operation} 抖动(${(e as Error)?.message}),${DB_RETRY_BASE_MS * attempt}ms 后重试`,
            );
            await sleep(DB_RETRY_BASE_MS * attempt);
          }
        }
      },
    },
  }) as unknown as PrismaClient;
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}
