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
  // 稀遇(隐藏)设定:命中稀遇原型时附上,前端亮徽章;普通 NPC 为 null/省略。
  rarity?: { label: string; flavor: string } | null;
};

/**
 * NPC 状态:8 个维度(1-10)+ 一句对玩家/本轮的内心看法。
 * 维度含义见 lib/npc-state.ts 的 DIMENSIONS。每轮随对话变化,影响作答语气。
 */
export type NpcState = {
  affinity: number; // 好感:1 厌烦 ↔ 10 亲密
  trust: number; // 信任:1 戒备 ↔ 10 深信
  respect: number; // 尊敬:1 轻视 ↔ 10 敬重
  joy: number; // 情绪:1 悲伤 ↔ 10 喜悦
  calm: number; // 松弛:1 紧张 ↔ 10 放松
  vulnerability: number; // 袒露:1 防备 ↔ 10 敞开心扉
  gratitude: number; // 感激:1 愤怒 ↔ 10 感恩(双极,中性≈5)
  curiosity: number; // 好奇:1 冷淡 ↔ 10 好奇
  perception: string; // ≤60 字内心看法
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
  interest?: string; // 用户填写的兴趣(影响检索/简介/NPC);空则走默认随机亲历者
  lat?: number; // 地球坐标(存对话/恢复时飞回用)
  lng?: number;
  messages: ChatMessage[]; // 对话历史(含开场白作为首条 assistant)
  // NPC 状态:每轮更新并注入下一轮系统提示词,影响作答语气。
  state?: NpcState;
  // 访客(未登录)会话才有:guestId 标识访客身份用于用量限制;
  // guestTurns 累计该段对话用户发言轮数,模式切换不重置(防绕过 3 轮上限)。
  guestId?: string;
  guestTurns?: number;
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
  | { type: 'guestQuota'; remaining: number } // 访客:本次开启后还能开启的对话数
  | { type: 'rare'; label: string; flavor: string } // 命中稀遇对象:前端亮徽章 + toast
  | { type: 'npcState'; state: NpcState } // NPC 初始状态(research 一次性下发)
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
  interest?: string;
  lat?: number;
  lng?: number;
  events: WikiEvent[];
  messages: ChatMessage[];
  favorite: boolean;
  state?: NpcState; // NPC 状态快照(每轮更新,resume 时恢复)
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
