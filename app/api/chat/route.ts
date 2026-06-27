import { NextRequest } from 'next/server';
import { z } from 'zod';
import { appendMessage, getSession } from '@/lib/runtime-state';
import { streamChat } from '@/lib/llm';
import { chatBystanderSystem, chatCharacterSystem, chatLecturerSystem, findNarrativeCut, NARRATIVE_HOLDBACK } from '@/lib/prompts';
import { MAX_GUEST_ROUNDS } from '@/lib/guest-policy';
import { sanitizeState } from '@/lib/npc-state';
import { NpcState } from '@/lib/types';

export const runtime = 'nodejs';

const Body = z.object({
  sessionId: z.string().min(1),
  userMessage: z.string().min(1).max(2000),
});

/** 从哨兵后的文本里抠出状态 JSON(容错:取首个 { 到末个 })。失败返回 null。 */
function parseStateJson(text: string): any | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let input;
  try {
    input = Body.parse(await req.json());
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const session = getSession(input.sessionId);
  if (!session) return new Response('session not found', { status: 404 });

  // 访客每段对话限 N 轮。用 session.guestTurns 计数(模式切换不重置,防绕过)。
  // 超限 → 403,前端回滚乐观消息并锁定本轮 / 引导注册。
  if (session.guestId) {
    const turns = session.guestTurns ?? 0;
    if (turns >= MAX_GUEST_ROUNDS) {
      return new Response(
        JSON.stringify({ reason: 'guest_round_limit', error: `访客每段对话限 ${MAX_GUEST_ROUNDS} 轮,本轮已结束。` }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
    session.guestTurns = turns + 1;
  }

  // 失败回滚点:本轮若 LLM 失败(三次重试仍失败),需撤回刚追加的 user 消息
  // (否则客户端点"重试"会让同一条 user 消息重复入栈上下文),并退还访客已扣的轮数
  // (否则一次网络抖动就让访客白白损失一轮)。
  const beforeMsgLen = session.messages.length;
  const prevGuestTurns = session.guestId ? (session.guestTurns ?? 0) - 1 : undefined;
  appendMessage(input.sessionId, 'user', input.userMessage);

  const system =
    session.mode === 'character' && session.npc
      ? chatCharacterSystem({
          npc: session.npc,
          placeName: session.placeName,
          country: session.country,
          year: session.year,
          month: session.month,
          events: session.events,
          userLang: session.userLang,
          interest: session.interest,
          state: session.state,
        })
      : session.mode === 'bystander' && session.npc
        ? chatBystanderSystem({
            npc: session.npc,
            placeName: session.placeName,
            country: session.country,
            year: session.year,
            month: session.month,
            reason: session.sensitiveReason,
            events: session.events,
            userLang: session.userLang,
            interest: session.interest,
            state: session.state,
          })
        : chatLecturerSystem({
            placeName: session.placeName,
            country: session.country,
            year: session.year,
            month: session.month,
            reason: session.sensitiveReason,
            events: session.events,
            userLang: session.userLang,
            interest: session.interest,
          });

  const llmStream = await streamChat({ system, messages: session.messages });

  // 拦截流:把 LLM 的纯文本输出解析成 NDJSON 分帧。
  //  - 截断点(哨兵 @@NPCSTATE@@ 或脚手架标题,如"【你此刻的内心状态】")之前:
  //    角色回复正文 → {type:'chunk'} 实时下发(打字机效果),并累积为 narrative。
  //  - 截断点之后:当作状态区,尝试解析状态 JSON → 净化(限幅/越界裁剪)→ {type:'state'},并更新 session.state。
  //    把脚手架标题也当截断点,是为了兜住弱模型把系统提示词小节标题泄泄进回复的情况,
  //    保证用户永远看不到提示词内部文字。
  //  - 仅 character/bystander 会带状态输出;lecturer 无哨兵,通常全部当正文(除非也泄了脚手架标题)。
  // 滚动缓冲保证跨块的标记也能识别:每轮只外发"确定不含标记前缀"的前缀,尾部留作下轮判定。
  const holdback = NARRATIVE_HOLDBACK;
  const ndjson = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      const decoder = new TextDecoder();
      const reader = llmStream.getReader();
      let buf = '';
      let inState = false;
      let stateBuf = '';
      let narrative = '';

      const flushHead = (head: string) => {
        if (head) {
          emit({ type: 'chunk', text: head });
          narrative += head;
        }
      };

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          if (inState) {
            stateBuf += text;
            continue;
          }
          buf += text;
          const idx = findNarrativeCut(buf);
          if (idx !== -1) {
            flushHead(buf.slice(0, idx));
            stateBuf = buf.slice(idx); // 含标记本身,parseStateJson 仍能从中找到 JSON
            inState = true;
            buf = '';
          } else if (buf.length > holdback) {
            // 外发除最后 holdback 个字符外的前缀(尾部可能是某个标记的前缀)。
            const head = buf.slice(0, buf.length - holdback);
            flushHead(head);
            buf = buf.slice(buf.length - holdback);
          }
        }
        // 收尾:冲刷解码器残余,并处理最后缓冲里的标记/正文。
        const tail = decoder.decode();
        if (tail) {
          if (inState) stateBuf += tail;
          else buf += tail;
        }
        if (!inState) {
          const idx = findNarrativeCut(buf);
          if (idx !== -1) {
            flushHead(buf.slice(0, idx));
            stateBuf = buf.slice(idx);
            inState = true;
          } else {
            flushHead(buf);
            buf = '';
          }
        }

        // 解析状态(若有)并更新 session 状态,下发 state 帧。
        if (inState && session.state) {
          const parsed = parseStateJson(stateBuf);
          if (parsed) {
            const next: NpcState = sanitizeState(parsed, session.state);
            session.state = next;
            emit({ type: 'state', state: next });
          }
        }
        // 仅把正文(不含哨兵/JSON)写回会话历史,保持下一轮上下文干净。
        if (narrative.trim()) appendMessage(input.sessionId, 'assistant', narrative);
        emit({ type: 'done' });
      } catch {
        // 本轮失败:回滚 user 消息与访客轮数,使客户端重试不会重复入栈 / 双扣轮数。
        if (session.messages.length > beforeMsgLen) session.messages.length = beforeMsgLen;
        if (prevGuestTurns !== undefined) session.guestTurns = prevGuestTurns;
        try {
          emit({ type: 'error', message: '对话出错' });
        } catch {
          /* controller 已关 */
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(ndjson, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
    },
  });
}
