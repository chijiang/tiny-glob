import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserFromRequest } from '@/lib/auth';
import { friendToListView } from '@/lib/friends';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const friend = await prisma.friend.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, select: { role: true, content: true } },
      _count: { select: { messages: true } },
    },
  });
  if (!friend) return NextResponse.json({ error: '不存在' }, { status: 404 });

  return NextResponse.json({
    friend: friendToListView(friend),
    messages: friend.messages.map((m) => ({ role: m.role, content: m.content })),
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  // findFirst 限定 userId 防越权;delete 级联清 messages
  const existing = await prisma.friend.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: '不存在' }, { status: 404 });

  await prisma.friend.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
