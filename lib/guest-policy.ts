import { ChatMessage } from './types';

/**
 * 访客(未登录)用量限制。登录用户不受任何限制。
 * 目的:让访客能低成本体验,同时引导注册。
 */
export const MAX_GUEST_CONVERSATIONS = 2; // 最多开启 2 段对话
export const MAX_GUEST_ROUNDS = 3; // 每段对话最多 3 轮(一轮 = 一次用户发言 + 一次回复)

/**
 * 统计一段对话里用户已发言的轮数(开场白为 assistant,不计入)。
 * 仅用于客户端展示;服务端以 session.guestTurns 为准(不受模式切换重置影响)。
 */
export function countRounds(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === 'user').length;
}
