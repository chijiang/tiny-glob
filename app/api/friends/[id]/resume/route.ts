import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserFromRequest } from '@/lib/auth';
import { saveSession } from '@/lib/runtime-state';
import { friendToListView, sessionFromFriend } from '@/lib/friends';
import { SessionMode } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const friend = await prisma.friend.findFirst({
    where: { id: params.id, userId: user.id },
    include: { messages: true },
  });
  if (!friend) return NextResponse.json({ error: '不存在' }, { status: 404 });

  const sessionId = crypto.randomUUID();
  const state = sessionFromFriend(friend, sessionId);
  saveSession(state);

  const switchable: SessionMode[] | null =
    friend.mode === 'bystander' ? ['bystander', 'lecturer'] : null;

  return NextResponse.json({
    sessionId,
    friend: friendToListView(friend),
    npc: state.npc,
    mode: state.mode,
    sensitiveReason: state.sensitiveReason,
    messages: state.messages,
    modeOptions: switchable,
  });
}
