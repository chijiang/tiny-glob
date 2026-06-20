import { Friend, Message } from '@prisma/client';
import { prisma } from './prisma';
import { ChatMessage, Npc, SessionMode, SessionState, UserLang, WikiEvent } from './types';

export const MAX_FRIENDS = 3;

/**
 * 把一轮新对话写回朋友的消息表(继续聊不丢)。
 * 仅在 session 由恢复朋友而来(friendId 存在)时调用;新查阅的会话不写。
 */
export async function persistFriendMessage(
  friendId: string | undefined,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  if (!friendId || !content.trim()) return;
  await prisma.message.create({ data: { friendId, role, content } }).catch(() => {
    /* 写回失败不影响对话体验 */
  });
}

/**
 * 从内存 session 提取 Friend 创建所需数据。
 * 调用方需保证 session.npc 存在(character/bystander);lecturer 无 NPC 不可存。
 */
export function friendCreateDataFromSession(session: SessionState) {
  if (!session.npc) throw new Error('session has no npc to snapshot');
  const n = session.npc;
  return {
    name: n.name,
    age: n.age,
    gender: n.gender,
    occupation: n.occupation,
    family: n.family,
    personality: n.personality,
    openingLine: n.openingLine,
    mode: session.mode,
    placeName: session.placeName,
    country: session.country,
    year: session.year,
    month: session.month,
    userLang: session.userLang,
    sensitiveReason: session.sensitiveReason,
    events: session.events as unknown as object,
    lat: session.lat,
    lng: session.lng,
    messages: {
      create: session.messages.map((m) => ({ role: m.role, content: m.content })),
    },
  };
}

/**
 * Friend(+messages) → SessionState,塞进 runtime-state 后 /api/chat 即可零改动复用。
 */
export function sessionFromFriend(
  friend: Friend & { messages: Message[] },
  sessionId: string,
): SessionState {
  const npc: Npc = {
    name: friend.name,
    age: friend.age,
    gender: friend.gender,
    occupation: friend.occupation,
    family: friend.family,
    personality: friend.personality,
    openingLine: friend.openingLine,
  };
  const messages: ChatMessage[] = [...friend.messages]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  return {
    sessionId,
    mode: friend.mode as SessionMode,
    placeName: friend.placeName,
    country: friend.country,
    year: friend.year,
    month: friend.month,
    userLang: friend.userLang as UserLang,
    events: (friend.events as unknown as WikiEvent[]) ?? [],
    npc,
    sensitiveReason: friend.sensitiveReason ?? undefined,
    lat: friend.lat ?? undefined,
    lng: friend.lng ?? undefined,
    friendId: friend.id,
    messages,
  };
}

/** 给前端朋友列表用的精简视图 */
export function friendToListView(f: Friend & { _count?: { messages: number } }) {
  return {
    id: f.id,
    name: f.name,
    age: f.age,
    gender: f.gender,
    occupation: f.occupation,
    placeName: f.placeName,
    country: f.country,
    year: f.year,
    month: f.month,
    mode: f.mode as SessionMode,
    messageCount: f._count?.messages ?? 0,
    createdAt: f.createdAt,
    lat: f.lat,
    lng: f.lng,
  };
}
