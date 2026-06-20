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
  lat?: number; // 地球坐标(存朋友/恢复时飞回用)
  lng?: number;
  friendId?: string; // 若此 session 由恢复某位朋友而来,新对话会写回该 friend(继续聊不丢)
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
