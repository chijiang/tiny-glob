import { Conversation } from '@/lib/generated/prisma/client';
import { z } from 'zod';
import {
  ChatMessage,
  ConversationListItem,
  ConversationRecord,
  Npc,
  SessionMode,
  SessionState,
  UserLang,
  WikiEvent,
} from './types';

/** ConversationRecord 的 zod 校验,POST create / load 共用。 */
const npcSchema = z.object({
  name: z.string(),
  age: z.number(),
  gender: z.string(),
  occupation: z.string(),
  family: z.string(),
  personality: z.string(),
  openingLine: z.string(),
});
const wikiEventSchema = z.object({
  pageid: z.number(),
  title: z.string(),
  extract: z.string(),
  categories: z.array(z.string()),
  url: z.string(),
});
const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
export const conversationRecordSchema = z.object({
  id: z.string().optional(),
  localId: z.string().min(1),
  npc: npcSchema.nullable(),
  mode: z.enum(['character', 'bystander', 'lecturer']),
  placeName: z.string(),
  country: z.string(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  userLang: z.enum(['zh', 'en']),
  summary: z.string(),
  sensitiveReason: z.string().optional(),
  interest: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  events: z.array(wikiEventSchema),
  messages: z.array(chatMessageSchema),
  favorite: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** DB 行 → 完整 ConversationRecord(含 events/messages,用于 GET 单条/resume)。 */
export function rowToRecord(c: Conversation): ConversationRecord {
  return {
    id: c.id,
    localId: c.localId ?? '',
    npc: (c.npc as Npc | null) ?? null,
    mode: c.mode as SessionMode,
    placeName: c.placeName,
    country: c.country,
    year: c.year,
    month: c.month,
    userLang: c.userLang as UserLang,
    summary: c.summary ?? '',
    sensitiveReason: c.sensitiveReason ?? undefined,
    interest: c.interest ?? undefined,
    lat: c.lat ?? undefined,
    lng: c.lng ?? undefined,
    events: (c.events as WikiEvent[]) ?? [],
    messages: (c.messages as ChatMessage[]) ?? [],
    favorite: c.favorite,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** DB 行 → 列表精简视图(去 events/messages,补 messageCount)。 */
export function rowToListView(c: Conversation): ConversationListItem {
  const messages = (c.messages as ChatMessage[]) ?? [];
  return {
    id: c.id,
    localId: c.localId,
    npc: (c.npc as Npc | null) ?? null,
    mode: c.mode as SessionMode,
    placeName: c.placeName,
    country: c.country,
    year: c.year,
    month: c.month,
    favorite: c.favorite,
    messageCount: messages.length,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    lat: c.lat ?? undefined,
    lng: c.lng ?? undefined,
  };
}

/**
 * ConversationRecord → SessionState,塞进 runtime-state 后 /api/chat 零改动复用。
 * 用于 /api/conversations/load(本地与服务端记录走同一路径)。
 */
export function sessionFromConversation(rec: ConversationRecord, sessionId: string): SessionState {
  return {
    sessionId,
    mode: rec.mode,
    placeName: rec.placeName,
    country: rec.country,
    year: rec.year,
    month: rec.month,
    userLang: rec.userLang,
    events: rec.events,
    npc: rec.npc ?? undefined,
    sensitiveReason: rec.sensitiveReason,
    summary: rec.summary,
    interest: rec.interest,
    lat: rec.lat,
    lng: rec.lng,
    messages: rec.messages,
  };
}
