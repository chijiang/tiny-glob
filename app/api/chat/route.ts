import { NextRequest } from 'next/server';
import { z } from 'zod';
import { appendMessage, getSession } from '@/lib/runtime-state';
import { streamChat } from '@/lib/llm';
import { chatBystanderSystem, chatCharacterSystem, chatLecturerSystem, NPC_STATE_SENTINEL } from '@/lib/prompts';
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
  //  - 哨兵 @@NPCSTATE@@ 之前:角色回复正文 → {type:'chunk'} 实时下发(打字机效果),并累积为 narrative。
  //  - 哨兵之后:状态 JSON → 解析、净化(限幅/越界裁剪)→ {type:'state'},并更新 session.state。
  //  - 仅 character/bystander 会带哨兵(其 system 提示含输出格式);lecturer 无哨兵,全部当正文。
  // 滚动缓冲保证跨块的哨兵也能识别:每轮只外发"确定不含哨兵"的前缀,尾部留作下轮判定。
  const sLen = NPC_STATE_SENTINEL.length;
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
          const idx = buf.indexOf(NPC_STATE_SENTINEL);
          if (idx !== -1) {
            flushHead(buf.slice(0, idx));
            stateBuf = buf.slice(idx + sLen);
            inState = true;
            buf = '';
          } else if (buf.length > sLen) {
            // 外发除最后 sLen 个字符外的前缀(尾部可能是哨兵的前缀)。
            const head = buf.slice(0, buf.length - sLen);
            flushHead(head);
            buf = buf.slice(buf.length - sLen);
          }
        }
        // 收尾:冲刷解码器残余,并处理最后缓冲里的哨兵/正文。
        const tail = decoder.decode();
        if (tail) {
          if (inState) stateBuf += tail;
          else buf += tail;
        }
        if (!inState) {
          const idx = buf.indexOf(NPC_STATE_SENTINEL);
          if (idx !== -1) {
            flushHead(buf.slice(0, idx));
            stateBuf = buf.slice(idx + sLen);
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
