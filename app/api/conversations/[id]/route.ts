import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getUserFromRequest } from '@/lib/auth';
import { rowToRecord } from '@/lib/conversations';
import { ChatMessage, SessionMode } from '@/lib/types';

export const runtime = 'nodejs';

/** GET 单条完整记录(resume 用,含 events/messages)。仅本人可读。 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const row = await prisma.conversation.findFirst({ where: { id: params.id, userId: user.id } });
  if (!row) return NextResponse.json({ error: '不存在' }, { status: 404 });
  return NextResponse.json({ conversation: rowToRecord(row) });
}

// PATCH 三种操作:追加消息 / 切换收藏 / 切换模式(会重置 messages)
const PatchBody = z.discriminatedUnion('op', [
  z.object({ op: z.literal('appendMessage'), role: z.enum(['user', 'assistant']), content: z.string() }),
  z.object({ op: z.literal('toggleFavorite') }),
  z.object({ op: z.literal('updateMode'), mode: z.enum(['bystander', 'lecturer'] as const satisfies SessionMode[]), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })) }),
]);

async function ownOrFail(req: NextRequest, id: string) {
  const user = await getUserFromRequest(req);
  if (!user) return { err: NextResponse.json({ error: '未登录' }, { status: 401 }), user: null };
  return { err: null, user };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { err, user } = await ownOrFail(req, params.id);
  if (err || !user) return err;

  let body;
  try {
    body = PatchBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: '参数错误' }, { status: 400 });
  }

  // 所有操作都校验归属,避免越权
  const existing = await prisma.conversation.findFirst({ where: { id: params.id, userId: user.id } });
  if (!existing) return NextResponse.json({ error: '不存在' }, { status: 404 });

  if (body.op === 'appendMessage') {
    const messages = [...((existing.messages as ChatMessage[]) ?? []), { role: body.role, content: body.content }];
    await prisma.conversation.update({ where: { id: params.id }, data: { messages } });
    return NextResponse.json({ ok: true });
  }

  if (body.op === 'toggleFavorite') {
    const updated = await prisma.conversation.update({
      where: { id: params.id },
      data: { favorite: !existing.favorite },
    });
    return NextResponse.json({ favorite: updated.favorite });
  }

  // updateMode:模式切换会重置消息,整体覆盖 messages
  await prisma.conversation.update({
    where: { id: params.id },
    data: { mode: body.mode, messages: body.messages as unknown as object },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { err, user } = await ownOrFail(req, params.id);
  if (err || !user) return err;

  // 只删自己的(找不到不报错,幂等)
  await prisma.conversation.deleteMany({ where: { id: params.id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
