import OpenAI from 'openai';
import { Npc, SensitivityResult, UserLang, WikiEvent } from './types';
import type { NpcSeed } from './npc-seed';
import {
  generateBystanderPrompt,
  generateNpcPrompt,
  judgeSensitivityPrompt,
} from './prompts';

// OpenAI 兼容客户端:通过 LLM_BASE_URL 可指向任意 OpenAI-compatible 端点
// (OpenAI 官方 / DeepSeek / Moonshot / 智谱 GLM / 本地 Ollama / 网关代理等)。

let client: OpenAI | null = null;
export function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) throw new Error('LLM_API_KEY 未配置(请检查 .env.local)');
    const baseURL = process.env.LLM_BASE_URL || undefined; // 不填则用 SDK 默认(OpenAI 官方)
    client = new OpenAI({ apiKey, baseURL });
  }
  return client;
}

export function getModel(): string {
  return process.env.LLM_MODEL || 'gpt-4o-mini';
}

// DeepSeek v4 系列默认开启思考模式:响应会带 reasoning_content,并额外消耗 reasoning_tokens。
// 在此全局关闭。thinking 为 DeepSeek 的 OpenAI 兼容扩展字段;
// 用展开注入以绕过 OpenAI SDK 对未声明字段的多余属性检查(excess property check)。
const NO_THINKING = { thinking: { type: 'disabled' as const } };

type BriefOpts = {
  placeName: string;
  country: string;
  year: number;
  month: number;
  events: WikiEvent[];
  userLang: UserLang;
  interest?: string;
  seed?: NpcSeed | null;
};

type BystanderOpts = BriefOpts & { reason?: string };

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function withSystem(system: string, rest: { role: 'user' | 'assistant'; content: string }[]): Msg[] {
  return [
    { role: 'system', content: system },
    ...rest.map((m) => ({ role: m.role, content: m.content })),
  ];
}

const INTEREST_KEYWORD_GROUPS = [
  {
    triggers: ['music', 'musical', '音乐', '乐理', '声学', '作曲', '歌唱'],
    keywords: ['music', 'musical', '音乐', '乐理', '声学', '作曲', '乐谱', '合唱', '制琴', '调律', '管风琴', '乐器'],
  },
  {
    triggers: ['science', 'scientific', '科学', '自然科学', '物理', '化学', '数学', '天文', '生物'],
    keywords: ['science', 'scientific', '科学', '实验', '学者', '自然哲学', '仪器', '观测', '数学', '算学', '几何', '物理', '化学', '天文', '生物'],
  },
  {
    triggers: ['art', 'painting', 'sculpture', '绘画', '美术', '雕刻'],
    keywords: ['art', 'painting', 'sculpture', '绘画', '美术', '画师', '画匠', '画廊', '雕刻', '雕塑'],
  },
  {
    triggers: ['literature', 'writing', 'poetry', '文学', '写作', '诗歌'],
    keywords: ['literature', 'writing', 'poetry', '文学', '写作', '诗', '报社', '校对', '抄写', '印刷', '书商'],
  },
  {
    triggers: ['law', 'legal', '法律', '法学', '诉讼'],
    keywords: ['law', 'legal', '法律', '法学', '律师', '书记员', '法庭', '诉状', '法学学生'],
  },
  {
    triggers: ['architecture', 'architectural', '建筑', '土木'],
    keywords: ['architecture', 'architectural', '建筑', '制图', '木匠', '泥瓦', '营造', '工匠', '测绘'],
  },
];

function deriveInterestKeywords(interest?: string): string[] {
  const raw = interest?.trim();
  if (!raw) return [];

  const lower = raw.toLowerCase();
  const keywords = new Set<string>();

  for (const token of lower.split(/[^a-z0-9]+/).filter((t) => t.length >= 3)) {
    keywords.add(token);
  }
  for (const group of INTEREST_KEYWORD_GROUPS) {
    if (group.triggers.some((trigger) => lower.includes(trigger))) {
      for (const keyword of group.keywords) keywords.add(keyword.toLowerCase());
    }
  }
  return Array.from(keywords);
}

function matchedInterestKeywordGroups(interest?: string): string[][] {
  const raw = interest?.trim().toLowerCase();
  if (!raw) return [];
  return INTEREST_KEYWORD_GROUPS
    .filter((group) => group.triggers.some((trigger) => raw.includes(trigger)))
    .map((group) => group.keywords.map((keyword) => keyword.toLowerCase()));
}

function isInterestAlignedNpc(npc: Partial<Npc>, interest?: string): boolean {
  const keywords = deriveInterestKeywords(interest);
  if (keywords.length === 0) return true;

  const occupation = (npc.occupation ?? '').toLowerCase();
  const groupedKeywords = matchedInterestKeywordGroups(interest);
  if (groupedKeywords.some((group) => group.some((keyword) => occupation.includes(keyword)))) return true;

  const combinedText = `${occupation} ${npc.family ?? ''} ${npc.openingLine ?? ''}`.toLowerCase();
  if (groupedKeywords.length > 0) {
    const matchedGroups = groupedKeywords.filter((group) => group.some((keyword) => combinedText.includes(keyword))).length;
    return matchedGroups >= Math.min(2, groupedKeywords.length);
  }
  return keywords.some((keyword) => combinedText.includes(keyword));
}

async function generateNpcJson(system: string, user: string, temperature: number): Promise<Npc> {
  const res = await getClient().chat.completions.create({
    model: getModel(),
    ...NO_THINKING,
    max_tokens: 4096,
    temperature,
    messages: withSystem(system, [{ role: 'user', content: user }]),
  });
  const text = res.choices[0]?.message?.content ?? '';
  const json = extractJson(text);
  return { ...DEFAULT_NPC, ...json, age: Number(json.age) || DEFAULT_NPC.age };
}

async function generateNpcWithInterestRetry(system: string, user: string, interest: string): Promise<Npc> {
  const first = await generateNpcJson(system, user, 0.55);
  if (isInterestAlignedNpc(first, interest)) return first;

  const reinforcedUser =
    user +
    `\n\n上一次输出不合格,因为它没有让用户一眼看出角色与「${interest}」直接相关,用户无法据此深入讨论该兴趣。\n` +
    `上一次 JSON:\n${JSON.stringify(first, null, 2)}\n\n` +
    `请重新生成一个全新的 JSON,并严格满足:\n` +
    `1. occupation 必须与「${interest}」直接相关,不能是无关职业。\n` +
    `2. openingLine 要自然提到 ta 正在学/做/关心该领域的事。\n` +
    `3. 仍然必须是当地同时代的普通人,不是名家或历史名人。\n` +
    `只输出 JSON。`;

  try {
    return await generateNpcJson(system, reinforcedUser, 0.35);
  } catch {
    return first;
  }
}

/** NPC 生成(非流式 JSON) */
export async function generateNpc(opts: BriefOpts): Promise<Npc> {
  const { system, user } = generateNpcPrompt(opts);
  const interest = opts.interest?.trim();
  return interest ? generateNpcWithInterestRetry(system, user, interest) : generateNpcJson(system, user, 0.65);
}

/** 旁观者 NPC 生成(敏感事件用,非流式 JSON) */
export async function generateBystander(opts: BystanderOpts): Promise<Npc> {
  const { system, user } = generateBystanderPrompt(opts);
  const interest = opts.interest?.trim();
  return interest ? generateNpcWithInterestRetry(system, user, interest) : generateNpcJson(system, user, 0.65);
}

/** 敏感事件 LLM 兜底判定 */
export async function judgeSensitivity(opts: {
  placeName: string;
  year: number;
  month: number;
  events: WikiEvent[];
}): Promise<SensitivityResult> {
  const { system, user } = judgeSensitivityPrompt(opts);
  const res = await getClient().chat.completions.create({
    model: getModel(),
    ...NO_THINKING,
    max_tokens: 2048,
    temperature: 0,
    messages: withSystem(system, [{ role: 'user', content: user }]),
  });
  const text = res.choices[0]?.message?.content ?? '';
  try {
    const j = extractJson(text);
    return {
      sensitive: !!j.sensitive,
      reason: typeof j.reason === 'string' ? j.reason : undefined,
    };
  } catch {
    return { sensitive: false };
  }
}

/** 对话流式:返回 ReadableStream,供 route 直接 return */
export async function streamChat(args: {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}): Promise<ReadableStream<Uint8Array>> {
  const stream = await getClient().chat.completions.create({
    model: getModel(),
    ...NO_THINKING,
    max_tokens: 4096,
    temperature: 0.7,
    stream: true,
    messages: withSystem(args.system, args.messages),
  });
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
      } catch (e) {
        controller.error(e);
      } finally {
        controller.close();
      }
    },
  });
}

function extractJson(text: string): any {
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('no json found');
  return JSON.parse(cleaned.slice(start, end + 1));
}

const DEFAULT_NPC: Npc = {
  name: '路人',
  age: 30,
  gender: '未知',
  occupation: '普通居民',
  family: '独居',
  personality: '平和',
  openingLine: '你好,有什么想聊聊的吗?',
};
