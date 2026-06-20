import OpenAI from 'openai';
import { Npc, SensitivityResult, UserLang, WikiEvent } from './types';
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

type BriefOpts = {
  placeName: string;
  country: string;
  year: number;
  month: number;
  events: WikiEvent[];
  userLang: UserLang;
};

type BystanderOpts = BriefOpts & { reason?: string };

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function withSystem(system: string, rest: { role: 'user' | 'assistant'; content: string }[]): Msg[] {
  return [
    { role: 'system', content: system },
    ...rest.map((m) => ({ role: m.role, content: m.content })),
  ];
}

/** NPC 生成(非流式 JSON) */
export async function generateNpc(opts: BriefOpts): Promise<Npc> {
  const { system, user } = generateNpcPrompt(opts);
  const res = await getClient().chat.completions.create({
    model: getModel(),
    max_tokens: 300,
    temperature: 0.8,
    messages: withSystem(system, [{ role: 'user', content: user }]),
  });
  const text = res.choices[0]?.message?.content ?? '';
  const json = extractJson(text);
  return { ...DEFAULT_NPC, ...json, age: Number(json.age) || DEFAULT_NPC.age };
}

/** 旁观者 NPC 生成(敏感事件用,非流式 JSON) */
export async function generateBystander(opts: BystanderOpts): Promise<Npc> {
  const { system, user } = generateBystanderPrompt(opts);
  const res = await getClient().chat.completions.create({
    model: getModel(),
    max_tokens: 300,
    temperature: 0.8,
    messages: withSystem(system, [{ role: 'user', content: user }]),
  });
  const text = res.choices[0]?.message?.content ?? '';
  const json = extractJson(text);
  return { ...DEFAULT_NPC, ...json, age: Number(json.age) || DEFAULT_NPC.age };
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
    max_tokens: 80,
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
    max_tokens: 600,
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
