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
    // 关闭 SDK 自带重试(maxRetries:0),统一由下方 withRetry 接管,避免双重重试与叠加退避。
    client = new OpenAI({ apiKey, baseURL, maxRetries: 0 });
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

// ===== 请求重试 =====
// 网络不稳时 LLM 请求可能间歇性失败(连接重置/超时/限流/5xx)。SDK 自带重试已在
// maxRetries:0 关闭,统一由此处接管:最多 MAX_LLM_ATTEMPTS 次,仅对可重试错误重试
// (4xx 立即失败以避免无谓等待),简单线性退避。三次仍失败才向上抛错。
const MAX_LLM_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 是否值得重试:连接/超时/限流(429)/5xx → 重试;其余 4xx → 立即失败。 */
function isRetryableLLMError(e: unknown): boolean {
  if (e == null) return false;
  const status = (e as { status?: number }).status;
  if (typeof status === 'number') return status === 429 || status >= 500;
  const text =
    `${(e as { constructor?: { name?: string } })?.constructor?.name ?? ''} ${
      (e as { message?: string })?.message ?? ''
    }`.toLowerCase();
  return /connection|timeout|econnreset|etimedout|enotfound|eai_again|socket hang up|fetch failed|network|aborted/.test(
    text,
  );
}

/** 把单次 LLM 调用包成"最多 MAX_LLM_ATTEMPTS 次、仅可重试错误重试"的版本。 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_LLM_ATTEMPTS || !isRetryableLLMError(e)) throw e;
      await sleep(RETRY_BASE_MS * attempt); // 500ms、1000ms
    }
  }
  throw lastErr; // 理论不可达
}

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
  const res = await withRetry(() =>
    getClient().chat.completions.create({
      model: getModel(),
      ...NO_THINKING,
      max_tokens: 4096,
      temperature,
      messages: withSystem(system, [{ role: 'user', content: user }]),
    }),
  );
  const text = res.choices[0]?.message?.content ?? '';
  const json = extractJson(text);
  return { ...DEFAULT_NPC, ...json, age: Number(json.age) || DEFAULT_NPC.age };
}

/** 校验生成结果的性别是否与掷骰种子一致;罕见设定类(非简单男女)无法机械判定,放行。 */
function matchesSeedGender(npc: Partial<Npc>, seed: NpcSeed | null | undefined): boolean {
  if (!seed) return true;
  const want = seed.gender;
  if (want !== '女' && want !== '男') return true;
  const raw = (npc.gender ?? '').trim().toLowerCase();
  if (!raw) return false;
  if (want === '女') return raw.includes('女') || /female|woman|girl|lady/.test(raw);
  return raw.includes('男') || /male|man|boy/.test(raw);
}

// 对抗 LLM 默认偏向的确定性兜底:种子掷出的性别/兴趣是【硬约束】,不靠模型自觉。
// 生成后逐项校验,失败则带上"上次哪里错了"的强化提示重试,期间始终保留最不坏的候选。
const MAX_NPC_ATTEMPTS = 3;

async function generateNpcEnforcingSeed(
  system: string,
  user: string,
  seed: NpcSeed | null | undefined,
  interest: string | undefined,
): Promise<Npc> {
  const baseTemp = interest ? 0.55 : 0.65;
  let best: Npc | null = null;
  let feedback = '';

  for (let attempt = 1; attempt <= MAX_NPC_ATTEMPTS; attempt++) {
    const npc = await generateNpcJson(system, feedback ? user + feedback : user, attempt === 1 ? baseTemp : 0.35);
    const genderOk = matchesSeedGender(npc, seed);
    const interestOk = !interest || isInterestAlignedNpc(npc, interest);

    // 记忆最不坏的候选:优先性别正确(性别是更硬的人口属性)。
    if (!best || (!matchesSeedGender(best, seed) && genderOk)) best = npc;
    if (genderOk && interestOk) return npc;

    const issues: string[] = [];
    if (!genderOk && seed) {
      issues.push(
        `性别硬约束失败:要求「${seed.gender}」,但上次 gender 为「${npc.gender ?? '(空)'}」。` +
          `这次 gender 必须为「${seed.gender}」,且 name、occupation 都要与此性别一致——姓名用符合该性别的当地名字,职业不要默认男性化。`,
      );
    }
    if (!interestOk && interest) {
      issues.push(
        `兴趣关联失败:用户关心「${interest}」,但 occupation(${npc.occupation ?? '(空)'})未能一眼看出与该领域直接相关。` +
          `occupation 必须直接贴合「${interest}」(如美术学生/法学学生/学徒画师/乐谱誊写员/制琴学徒/自然哲学学生等),openingLine 也要自然带出 ta 正在学/做该领域的事。`,
      );
    }
    feedback =
      `\n\n【上一次输出不合格,请重新生成一个全新的 JSON 并严格修正,不要原样重复】\n` +
      issues.map((s) => `- ${s}`).join('\n') +
      `\n上一次 JSON(仅供参考):\n${JSON.stringify(npc, null, 2)}\n` +
      `仍然必须是当地同时代的普通人(非名家/历史名人)。只输出 JSON。`;
  }
  return best!;
}

/** NPC 生成(非流式 JSON) */
export async function generateNpc(opts: BriefOpts): Promise<Npc> {
  const { system, user } = generateNpcPrompt(opts);
  return generateNpcEnforcingSeed(system, user, opts.seed, opts.interest?.trim());
}

/** 旁观者 NPC 生成(敏感事件用,非流式 JSON) */
export async function generateBystander(opts: BystanderOpts): Promise<Npc> {
  const { system, user } = generateBystanderPrompt(opts);
  return generateNpcEnforcingSeed(system, user, opts.seed, opts.interest?.trim());
}

/** 敏感事件 LLM 兜底判定 */
export async function judgeSensitivity(opts: {
  placeName: string;
  year: number;
  month: number;
  events: WikiEvent[];
}): Promise<SensitivityResult> {
  const { system, user } = judgeSensitivityPrompt(opts);
  const res = await withRetry(() =>
    getClient().chat.completions.create({
      model: getModel(),
      ...NO_THINKING,
      max_tokens: 2048,
      temperature: 0,
      messages: withSystem(system, [{ role: 'user', content: user }]),
    }),
  );
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

/**
 * 对话流式:返回 ReadableStream,供 route 直接 return。
 * 网络抖动重试:建连或首个 token 前失败 → 最多重试 MAX_LLM_ATTEMPTS 次。
 * 一旦已向下游下发过任何正文(sentAny),就不再重试——重发会导致内容重复,只能报错。
 */
export async function streamChat(args: {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
        let sentAny = false;
        try {
          const stream = await getClient().chat.completions.create({
            model: getModel(),
            ...NO_THINKING,
            max_tokens: 4096,
            temperature: 0.7,
            stream: true,
            messages: withSystem(args.system, args.messages),
          });
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              controller.enqueue(encoder.encode(delta));
              sentAny = true;
            }
          }
          controller.close();
          return; // 成功完成
        } catch (e) {
          // 已下发内容(会重复) / 已到上限 / 不可重试错误 → 终止并报错。
          if (sentAny || attempt === MAX_LLM_ATTEMPTS || !isRetryableLLMError(e)) {
            controller.error(e);
            return;
          }
          await sleep(RETRY_BASE_MS * attempt); // 500ms、1000ms,然后重试
        }
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
