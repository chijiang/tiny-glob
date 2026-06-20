import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getUserFromRequest } from '@/lib/auth';
import { getSession } from '@/lib/runtime-state';
import { friendCreateDataFromSession, friendToListView, MAX_FRIENDS } from '@/lib/friends';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const friends = await prisma.friend.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { messages: true } } },
  });
  return NextResponse.json({ friends: friends.map(friendToListView), max: MAX_FRIENDS });
}

const SaveBody = z.object({ sessionId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let input;
  try {
    input = SaveBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: '参数错误' }, { status: 400 });
  }

  const session = getSession(input.sessionId);
  if (!session) return NextResponse.json({ error: '会话已过期,请重新查阅' }, { status: 404 });
  if (!session.npc) {
    return NextResponse.json({ error: '当前是讲解员模式,没有可保存的角色' }, { status: 400 });
  }

  const count = await prisma.friend.count({ where: { userId: user.id } });
  if (count >= MAX_FRIENDS) {
    return NextResponse.json({ error: `最多保存 ${MAX_FRIENDS} 位朋友,请先移除一位` }, { status: 409 });
  }

  const created = await prisma.friend.create({
    data: { userId: user.id, ...friendCreateDataFromSession(session) },
    include: { _count: { select: { messages: true } } },
  });
  return NextResponse.json({ friend: friendToListView(created) }, { status: 201 });
}
