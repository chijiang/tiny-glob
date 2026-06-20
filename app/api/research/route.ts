import { NextRequest } from 'next/server';
import { z } from 'zod';
import { reverseGeocode } from '@/lib/nominatim';
import { ruleBasedSensitive } from '@/lib/sensitivity';
import { generateNpc, generateBystander, judgeSensitivity } from '@/lib/llm';
import { runResearchAgent, streamAgentSummary } from '@/lib/agent';
import { saveSession } from '@/lib/runtime-state';
import { ResearchFrame, SessionMode, SessionState } from '@/lib/types';

export const runtime = 'nodejs';

const Body = z.object({
  lat: z.number(),
  lng: z.number(),
  year: z.number().int().min(1).max(2100),
  month: z.number().int().min(1).max(12),
  userLang: z.enum(['zh', 'en']),
});

export async function POST(req: NextRequest) {
  let input;
  try {
    input = Body.parse(await req.json());
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? 'bad request' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const closed = { value: false };
      const emit = (f: ResearchFrame) => {
        if (closed.value) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(f) + '\n'));
        } catch {
          closed.value = true;
        }
      };

      try {
        // 1. 反向地理编码
        const place = await reverseGeocode({ lat: input.lat, lng: input.lng });
        if (!place || !place.country) {
          emit({
            type: 'error',
            message: '此地点似乎没有可参考的人类历史记录,请改选陆地上的某个位置。',
          });
          emit({ type: 'done' });
          return;
        }
        emit({ type: 'place', name: place.name, country: place.country });

        // 2. ReAct agent 多角度搜集真实 Wikipedia 资料(支持 fallback 降级)
        const agentResult = await runResearchAgent({
          lat: input.lat,
          lng: input.lng,
          placeName: place.name,
          country: place.country,
          year: input.year,
          month: input.month,
          userLang: input.userLang,
          onProgress: (text) => emit({ type: 'progress', text }),
        });
        const events = agentResult.events;

        // 3. 敏感判定:层 1 规则 → 层 2 LLM 兜底
        // 命中 → 默认进入「旁观者」模式(同代异地、非亲历),用户可在前端切换为讲解员
        let mode: SessionMode = 'character';
        let reason: string | undefined;
        const ruleHit = ruleBasedSensitive(events);
        if (ruleHit?.sensitive) {
          mode = 'bystander';
          reason = ruleHit.reason;
        } else if (events.length > 0) {
          const judge = await judgeSensitivity({
            placeName: place.name,
            year: input.year,
            month: input.month,
            events,
          });
          if (judge.sensitive) {
            mode = 'bystander';
            reason = judge.reason;
          }
        }
        const sensitive = mode !== 'character';
        emit({ type: 'sensitive', value: sensitive, reason });

        // 4. 事件简述(流式,基于 agent 收集的资料)
        await streamAgentSummary(
          {
            placeName: place.name,
            country: place.country,
            year: input.year,
            month: input.month,
            events,
            userLang: input.userLang,
          },
          (text) => emit({ type: 'summary_chunk', text }),
        );

        // 5. NPC 生成:character(非敏感)或 bystander(敏感,非亲历旁观者)
        const sessionId = crypto.randomUUID();
        let npc;
        if (mode === 'character') {
          npc = await generateNpc({
            placeName: place.name,
            country: place.country,
            year: input.year,
            month: input.month,
            events,
            userLang: input.userLang,
          });
          emit({ type: 'npc', mode: 'character', npc });
        } else {
          // 敏感:生成旁观者 NPC,并告知前端可切换 bystander↔lecturer
          npc = await generateBystander({
            placeName: place.name,
            country: place.country,
            year: input.year,
            month: input.month,
            events,
            reason,
            userLang: input.userLang,
          });
          emit({ type: 'npc', mode: 'bystander', npc });
          emit({ type: 'modeOptions', options: ['bystander', 'lecturer'] });
        }

        // 6. 保存会话状态(npc 在敏感会话里始终保留,切到 lecturer 时也不丢,以便切回)
        const openingLine = npc?.openingLine ?? '';
        const state: SessionState = {
          sessionId,
          mode,
          placeName: place.name,
          country: place.country,
          year: input.year,
          month: input.month,
          userLang: input.userLang,
          events,
          npc,
          sensitiveReason: reason,
          lat: input.lat,
          lng: input.lng,
          messages: openingLine ? [{ role: 'assistant', content: openingLine }] : [],
        };
        saveSession(state);

        emit({ type: 'sessionId', id: sessionId });
        emit({ type: 'done' });
      } catch (e: any) {
        emit({ type: 'error', message: e?.message ?? '内部错误' });
        emit({ type: 'done' });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
    },
  });
}
