import { MAX_GUEST_CONVERSATIONS } from './guest-policy';

// 进程内存:guestId → 已开启对话数。重启即失(MVP,与 runtime-state 同策略)。
// 挂 globalThis 保证跨路由/热重载单例,避免 dev 模式 module 重新求值丢计数。
const globalForGuests = globalThis as unknown as { __tinyGlobGuestUsage?: Map<string, number> };
const usage: Map<string, number> = globalForGuests.__tinyGlobGuestUsage ?? new Map();
if (!globalForGuests.__tinyGlobGuestUsage) {
  globalForGuests.__tinyGlobGuestUsage = usage;
}

/** 该访客是否还能开启新对话。 */
export function canStartConversation(guestId: string): boolean {
  return (usage.get(guestId) ?? 0) < MAX_GUEST_CONVERSATIONS;
}

/** 记一次成功开启(在 research 保存会话后调用)。 */
export function recordConversation(guestId: string): void {
  usage.set(guestId, (usage.get(guestId) ?? 0) + 1);
}

/** 本次开启后,还剩余可开启的对话次数(下发前端展示用)。 */
export function conversationsRemaining(guestId: string): number {
  return Math.max(0, MAX_GUEST_CONVERSATIONS - (usage.get(guestId) ?? 0));
}
