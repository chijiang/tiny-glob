import { NextRequest } from 'next/server';
import { z } from 'zod';
import { appendMessage, getSession } from '@/lib/runtime-state';
import { streamChat } from '@/lib/llm';
import { persistFriendMessage } from '@/lib/friends';
import { chatBystanderSystem, chatCharacterSystem, chatLecturerSystem } from '@/lib/prompts';

export const runtime = 'nodejs';

const Body = z.object({
  sessionId: z.string().min(1),
  userMessage: z.string().min(1).max(2000),
});

export async function POST(req: NextRequest) {
  let input;
  try {
    input = Body.parse(await req.json());
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const session = getSession(input.sessionId);
  if (!session) return new Response('session not found', { status: 404 });

  appendMessage(input.sessionId, 'user', input.userMessage);
  // 若此会话由恢复朋友而来,把用户消息也写回朋友的消息表
  persistFriendMessage(session.friendId, 'user', input.userMessage);

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
          })
        : chatLecturerSystem({
            placeName: session.placeName,
            country: session.country,
            year: session.year,
            month: session.month,
            reason: session.sensitiveReason,
            events: session.events,
            userLang: session.userLang,
          });

  const body = await streamChat({ system, messages: session.messages });

  // 拦截流:边返回给客户端边累积 assistant 回复,流结束后存入 session 历史
  const decoder = new TextDecoder();
  let assistantText = '';
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      assistantText += decoder.decode(chunk, { stream: true });
      controller.enqueue(chunk);
    },
    flush() {
      appendMessage(input.sessionId, 'assistant', assistantText);
      persistFriendMessage(session.friendId, 'assistant', assistantText);
    },
  });

  return new Response(body.pipeThrough(transform), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
    },
  });
}
