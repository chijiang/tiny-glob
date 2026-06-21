'use client';

import { ChatMessage, ConversationListItem, ConversationRecord, SessionMode } from './types';

// 仅取登录用户判断用得到的形状(避免与 auth-context 形成循环依赖)
type AuthUserLike = { id: string; email: string } | null;

/**
 * 对话持久化抽象:登录用户走服务端 DB,匿名用户走浏览器 localStorage。
 * 两侧记录形态一致(ConversationRecord),切换后端对调用方透明。
 * 登录时 uploadLocal() 把本地记录按 localId upsert 到服务端并清空本地。
 */
const LOCAL_KEY = 'tg.conversations.v1';

export interface ConversationStore {
  list(favorite?: boolean): Promise<ConversationListItem[]>;
  get(id: string): Promise<ConversationRecord | null>;
  create(rec: ConversationRecord): Promise<ConversationRecord>;
  appendMessage(id: string, role: 'user' | 'assistant', content: string): Promise<void>;
  updateMode(id: string, mode: SessionMode, messages: ChatMessage[]): Promise<void>;
  toggleFavorite(id: string): Promise<void>;
  delete(id: string): Promise<void>;
}

// ============ localStorage 后端 ============

function localRead(): ConversationRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as ConversationRecord[]) : [];
  } catch {
    return [];
  }
}

function localWrite(records: ConversationRecord[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(records));
}

function localIdOf(rec: ConversationRecord) {
  return 'local:' + rec.localId;
}

function toListItem(rec: ConversationRecord): ConversationListItem {
  return {
    id: rec.id ?? localIdOf(rec),
    localId: rec.localId,
    npc: rec.npc,
    mode: rec.mode,
    placeName: rec.placeName,
    country: rec.country,
    year: rec.year,
    month: rec.month,
    favorite: rec.favorite,
    messageCount: rec.messages.length,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    lat: rec.lat,
    lng: rec.lng,
  };
}

const LocalStore: ConversationStore = {
  async list(favorite) {
    const recs = localRead();
    const filtered = favorite ? recs.filter((r) => r.favorite) : recs;
    return filtered
      .map(toListItem)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },
  async get(id) {
    const rec = localRead().find((r) => (r.id ?? localIdOf(r)) === id);
    return rec ?? null;
  },
  async create(rec) {
    const created: ConversationRecord = { ...rec, id: localIdOf(rec) };
    const recs = localRead();
    recs.push(created);
    localWrite(recs);
    return created;
  },
  async appendMessage(id, role, content) {
    const recs = localRead();
    const i = recs.findIndex((r) => (r.id ?? localIdOf(r)) === id);
    if (i < 0) return;
    recs[i].messages = [...recs[i].messages, { role, content }];
    recs[i].updatedAt = new Date().toISOString();
    localWrite(recs);
  },
  async updateMode(id, mode, messages) {
    const recs = localRead();
    const i = recs.findIndex((r) => (r.id ?? localIdOf(r)) === id);
    if (i < 0) return;
    recs[i].mode = mode;
    recs[i].messages = messages;
    recs[i].updatedAt = new Date().toISOString();
    localWrite(recs);
  },
  async toggleFavorite(id) {
    const recs = localRead();
    const i = recs.findIndex((r) => (r.id ?? localIdOf(r)) === id);
    if (i < 0) return;
    recs[i].favorite = !recs[i].favorite;
    recs[i].updatedAt = new Date().toISOString();
    localWrite(recs);
  },
  async delete(id) {
    localWrite(localRead().filter((r) => (r.id ?? localIdOf(r)) !== id));
  },
};

// ============ 服务端后端 ============

async function jsonOk(res: Response) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const ServerStore: ConversationStore = {
  async list(favorite) {
    const q = favorite ? '?favorite=true' : '';
    const data = await jsonOk(await fetch(`/api/conversations${q}`));
    return (data.conversations ?? []) as ConversationListItem[];
  },
  async get(id) {
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.conversation ?? null) as ConversationRecord | null;
  },
  async create(rec) {
    const data = await jsonOk(
      await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rec),
      }),
    );
    return data.conversation as ConversationRecord;
  },
  async appendMessage(id, role, content) {
    await jsonOk(
      await fetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'appendMessage', role, content }),
      }),
    );
  },
  async updateMode(id, mode, messages) {
    await jsonOk(
      await fetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'updateMode', mode, messages }),
      }),
    );
  },
  async toggleFavorite(id) {
    await jsonOk(
      await fetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'toggleFavorite' }),
      }),
    );
  },
  async delete(id) {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
  },
};

// ============ 工厂 + 登录合并 ============

/** 按登录态选后端。登录 → 服务端;匿名 → localStorage。 */
export function getStore(user: AuthUserLike): ConversationStore {
  return user ? ServerStore : LocalStore;
}

/**
 * 登录后调用:把本地(localStorage)记录上传到服务端(upsert by localId),
 * 成功一条就从本地删一条;失败保留,下次登录重试。best-effort,不抛错。
 */
export async function uploadLocal(): Promise<void> {
  const recs = localRead();
  if (recs.length === 0) return;
  const successIds: string[] = [];
  for (const rec of recs) {
    try {
      await ServerStore.create(rec);
      successIds.push(rec.id ?? localIdOf(rec));
    } catch {
      /* 留在本地,下次重试 */
    }
  }
  if (successIds.length > 0) {
    localWrite(localRead().filter((r) => !successIds.includes(r.id ?? localIdOf(r))));
  }
}
