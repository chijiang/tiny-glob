import OpenAI from 'openai';
import { getClient, getModel } from './llm';
import { buildToolSchemas, dispatchTool, wikiGeosearch, wikiGetPage, wikiSearch } from './wiki-tools';
import { agentSystemPrompt, agentUserMessage, researchBriefPrompt } from './prompts';
import { ToolCallLog, UserLang, WikiEvent } from './types';

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const MAX_ROUNDS = 6;

export type AgentResult = {
  events: WikiEvent[];
  sourceLog: ToolCallLog[];
  usedFallback: boolean;
};

type AgentArgs = {
  lat: number;
  lng: number;
  placeName: string;
  country: string;
  year: number;
  month: number;
  userLang: UserLang;
  interest?: string;
  onProgress?: (text: string) => Promise<void> | void;
};

/**
 * ReAct research agent。多轮 function calling 循环收集真实 Wikipedia 资料。
 * 不支持 tool use 的端点会自动降级到 runFallbackCollect(静默,不报错)。
 */
export async function runResearchAgent(args: AgentArgs): Promise<AgentResult> {
  const client = getClient();
  const tools = buildToolSchemas();
  const collected: WikiEvent[] = [];
  const seenIds = new Set<number>();
  const sourceLog: ToolCallLog[] = [];

  const messages: Msg[] = [
    { role: 'system', content: agentSystemPrompt(args) },
    { role: 'user', content: agentUserMessage(args) },
  ];

  let toolCallCount = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await client.chat.completions.create({
      model: getModel(),
      temperature: 0.2,
      max_tokens: 500,
      messages,
      tools,
      tool_choice: 'auto',
    });
    const msg = res.choices[0]?.message;
    if (!msg) break;
    messages.push(msg as Msg);

    const toolCalls = msg.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // 第一轮就没工具调用 → 端点大概率不支持 function calling → fallback
      if (round === 0) {
        await runFallbackCollect(args, collected, seenIds);
        return { events: collected.slice(0, 15), sourceLog, usedFallback: true };
      }
      break; // 后续轮无工具调用 = agent 自行结束
    }

    // 并行执行本轮所有工具调用
    const results = await Promise.all(
      toolCalls.map(async (tcRaw) => {
        // openai v6 tool_calls 是联合类型(含 custom tool),断言到标准 function 形态
        const tc = tcRaw as { id: string; function: { name: string; arguments: string } };
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || '{}');
        } catch {
          parsedArgs = { _invalid: tc.function.arguments };
        }
        const out = await dispatchTool(tc.function.name, parsedArgs, args.country, collected, seenIds);
        sourceLog.push({ tool: tc.function.name, args: parsedArgs, summary: out.progress });
        if (out.progress) await args.onProgress?.(out.progress);
        return { tool_call_id: tc.id, content: JSON.stringify(out.data) };
      }),
    );
    toolCallCount += toolCalls.length;
    for (const r of results) {
      messages.push({ role: 'tool', tool_call_id: r.tool_call_id, content: r.content });
    }
  }

  // 循环结束但一次工具都没成功累积到事件 → fallback 兜底
  if (collected.length === 0) {
    await runFallbackCollect(args, collected, seenIds);
    return { events: collected.slice(0, 15), sourceLog, usedFallback: true };
  }

  return { events: collected.slice(0, 15), sourceLog, usedFallback: false };
}

/**
 * Fallback:不支持 function calling 时,跑增强版固定管道。
 * geosearch + wiki_search(place year) + wiki_search(country year) + 关键结果 get_page。
 */
export async function runFallbackCollect(
  args: AgentArgs,
  collected: WikiEvent[],
  seenIds: Set<number>,
): Promise<void> {
  const push = (e: WikiEvent) => {
    if (e.pageid && !seenIds.has(e.pageid)) {
      seenIds.add(e.pageid);
      collected.push(e);
    }
  };

  await args.onProgress?.('正在搜索当地资料…');
  const geo = await wikiGeosearch(args.lat, args.lng, 10000).catch(() => []);
  geo.forEach((g) =>
    push({ pageid: g.pageid, title: g.title, extract: g.extract, categories: g.categories, url: g.url }),
  );

  await args.onProgress?.('正在检索本地历史…');
  const local = await wikiSearch(`${args.placeName} ${args.year}`).catch(() => ({
    results: [],
    totalhits: 0,
  }));
  local.results.forEach((s) =>
    push({ pageid: s.pageid, title: s.title, extract: s.snippet, categories: [], url: s.url }),
  );

  await args.onProgress?.('正在搜索全国层面资料…');
  const national = await wikiSearch(`${args.country} ${args.year}`).catch(() => ({
    results: [],
    totalhits: 0,
  }));
  national.results.forEach((s) =>
    push({ pageid: s.pageid, title: s.title, extract: s.snippet, categories: [], url: s.url }),
  );

  // 深挖前 2 个全国结果(用全文 extract 覆盖 snippet)
  for (const s of national.results.slice(0, 2)) {
    await args.onProgress?.('正在深入阅读条目…');
    const page = await wikiGetPage({ pageid: s.pageid }).catch(() => null);
    if (page) {
      push({ pageid: page.pageid, title: page.title, extract: page.extract, categories: page.categories, url: page.url });
    }
  }

  // 兴趣领域检索(best-effort:无 function-calling 降级路径,interest 多为中文,en.wiki 命中弱也无妨)
  if (args.interest?.trim()) {
    await args.onProgress?.(`正在检索与「${args.interest.trim()}」相关的内容…`);
    const domain = await wikiSearch(`${args.interest.trim()} ${args.country} ${args.year}`).catch(() => ({
      results: [],
      totalhits: 0,
    }));
    domain.results.forEach((s) =>
      push({ pageid: s.pageid, title: s.title, extract: s.snippet, categories: [], url: s.url }),
    );
  }
}

/**
 * 独立流式总结。复用 researchBriefPrompt,把 agent 收集的 events 作为依据。
 * 替代旧的 streamBrief。
 */
export async function streamAgentSummary(
  args: {
    placeName: string;
    country: string;
    year: number;
    month: number;
    events: WikiEvent[];
    userLang: UserLang;
    interest?: string;
  },
  onChunk: (text: string) => Promise<void> | void,
): Promise<void> {
  const { system, user } = researchBriefPrompt(args);
  const stream = await getClient().chat.completions.create({
    model: getModel(),
    max_tokens: 400,
    temperature: 0.1,
    stream: true,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) await onChunk(delta);
  }
}
