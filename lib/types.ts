// 全局共享类型

export type Coords = { lat: number; lng: number };

export type UserLang = 'zh' | 'en';

export type PlaceInfo = {
  name: string; // 简短地名,如 "Hiroshima"
  displayName: string; // Nominatim 完整显示名
  country: string; // 国家名
  countryCode?: string;
};

export type WikiEvent = {
  pageid: number;
  title: string;
  extract: string; // intro 纯文本摘要
  categories: string[]; // category 标题列表(含 "Category:" 前缀)
  url: string;
};

export type Npc = {
  name: string;
  age: number;
  gender: string;
  occupation: string;
  family: string;
  personality: string;
  openingLine: string; // 第一人称开场白
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type SessionMode = 'character' | 'bystander' | 'lecturer';

export type SessionState = {
  sessionId: string;
  mode: SessionMode;
  placeName: string;
  country: string;
  year: number;
  month: number; // 1-12
  userLang: UserLang;
  events: WikiEvent[]; // grounding 用的真实事件
  npc?: Npc; // character/bystander 模式下存在(旁观者 NPC 在切到 lecturer 时仍保留,以便切回)
  sensitiveReason?: string; // 敏感原因(bystander/lecturer 引用)
  summary?: string; // 地区简介(resume 时回填,UI 用;服务端系统提示词暂不引用)
  lat?: number; // 地球坐标(存对话/恢复时飞回用)
  lng?: number;
  messages: ChatMessage[]; // 对话历史(含开场白作为首条 assistant)
};

export type ResearchRequest = {
  lat: number;
  lng: number;
  year: number;
  month: number;
  userLang: UserLang;
};

// /api/research 流式帧(NDJSON,每帧一行 JSON)
export type ResearchFrame =
  | { type: 'place'; name: string; country: string }
  | { type: 'summary_chunk'; text: string }
  | { type: 'sensitive'; value: boolean; reason?: string }
  | { type: 'npc'; mode: SessionMode; npc?: Npc }
  | { type: 'modeOptions'; options: SessionMode[] }
  | { type: 'events'; events: WikiEvent[] } // 下发 grounding 事件,客户端据此持久化可恢复记录
  | { type: 'sessionId'; id: string }
  | { type: 'progress'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export type SensitivityResult = {
  sensitive: boolean;
  reason?: string;
};

// agent 工具调用记录(调试用)
export type ToolCallLog = {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
};

/**
 * 一段已持久化的对话。客户端(localStorage)与服务端(DB)共用此形态,
 * 由 lib/conversation-store 抽象双后端,实现「记录所有对话」。
 * - id:服务端 cuid;本地记录为 'local:' + localId;新建(create)时省略,由 store 回填。
 * - localId:客户端生成的 UUID,用于登录上传时按之 upsert 去重(服务端记录为 null)。
 * - npc:讲师模式为 null。
 */
export type ConversationRecord = {
  id?: string;
  localId: string;
  npc: Npc | null;
  mode: SessionMode;
  placeName: string;
  country: string;
  year: number;
  month: number;
  userLang: UserLang;
  summary: string;
  sensitiveReason?: string;
  lat?: number;
  lng?: number;
  events: WikiEvent[];
  messages: ChatMessage[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
};

/** 列表精简视图:去掉体积大的 events/messages,补 messageCount。 */
export type ConversationListItem = {
  id: string;
  localId: string | null;
  npc: Npc | null;
  mode: SessionMode;
  placeName: string;
  country: string;
  year: number;
  month: number;
  favorite: boolean;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  lat?: number;
  lng?: number;
};
