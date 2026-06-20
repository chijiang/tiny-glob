import { ChatMessage, SessionMode, SessionState } from './types';

// 进程内存会话存储。重启即失,符合 MVP。
// 生产应换成 Redis/DB,这里刻意保持极简。
// 注意:Next.js dev 模式下各 API route 会被分别编译,共享模块会被重新求值,
// module-level 的 Map 会在路由首次编译时被重置 → research 存的 session 在 chat 里读不到。
// 挂到 globalThis 保证跨路由/跨热重载单例(Prisma 等库的标准做法)。
const globalForSessions = globalThis as unknown as { __tinyGlobSessions?: Map<string, SessionState> };
const sessions: Map<string, SessionState> =
  globalForSessions.__tinyGlobSessions ?? new Map();
if (!globalForSessions.__tinyGlobSessions) {
  globalForSessions.__tinyGlobSessions = sessions;
}

export function saveSession(state: SessionState): void {
  // 简易上限:超过 200 个会话时清掉最早插入的一半,防内存无限增长
  if (sessions.size >= 200) {
    const half = Math.floor(sessions.size / 2);
    let i = 0;
    for (const key of sessions.keys()) {
      sessions.delete(key);
      if (++i >= half) break;
    }
  }
  sessions.set(state.sessionId, state);
}

export function getSession(id: string): SessionState | undefined {
  return sessions.get(id);
}

export function appendMessage(id: string, role: 'user' | 'assistant', content: string): void {
  const s = sessions.get(id);
  if (s) s.messages.push({ role, content });
}

/**
 * 切换敏感会话的模式(bystander ↔ lecturer)。
 * - 切到 bystander 且 session 有旁观者 npc:messages 重置为 [openingLine]
 * - 切到 lecturer:messages 清空(讲解员无开场白,等用户首问)
 * - npc 始终保留在 session 里,以便切回旁观者时复用同一个角色
 * 返回更新后的 state;找不到 session 或模式非法返回 undefined。
 */
export function switchMode(id: string, mode: SessionMode): SessionState | undefined {
  const s = sessions.get(id);
  if (!s) return undefined;
  if (mode !== 'bystander' && mode !== 'lecturer') return undefined;
  s.mode = mode;
  let opening: ChatMessage[] = [];
  if (mode === 'bystander' && s.npc?.openingLine) {
    opening = [{ role: 'assistant', content: s.npc.openingLine }];
  }
  s.messages = opening;
  return s;
}
