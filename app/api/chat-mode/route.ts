import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession, switchMode } from '@/lib/runtime-state';
import { SessionMode } from '@/lib/types';

export const runtime = 'nodejs';

const Body = z.object({
  sessionId: z.string().min(1),
  mode: z.enum(['bystander', 'lecturer'] as const satisfies SessionMode[]),
});

export async function POST(req: NextRequest) {
  let input;
  try {
    input = Body.parse(await req.json());
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const existing = getSession(input.sessionId);
  if (!existing) return new Response('session not found', { status: 404 });

  // 只有敏感会话(bystander/lecturer)允许切换;character 不接受
  if (existing.mode === 'character') {
    return new Response('this session is not switchable', { status: 400 });
  }

  const updated = switchMode(input.sessionId, input.mode);
  if (!updated) return new Response('switch failed', { status: 400 });

  return new Response(
    JSON.stringify({
      mode: updated.mode,
      // 讲解员模式下 UI 应显示"历史讲解员";npc 仍保留在 session 内以便切回旁观者。
      npc: updated.mode === 'lecturer' ? null : updated.npc ?? null,
      openingLine: updated.npc?.openingLine ?? '',
      messages: updated.messages,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}
