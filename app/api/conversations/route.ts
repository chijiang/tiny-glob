import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { getUserFromRequest } from '@/lib/auth';
import { conversationRecordSchema, rowToListView, rowToRecord } from '@/lib/conversations';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const favorite = req.nextUrl.searchParams.get('favorite') === 'true';
  const rows = await prisma.conversation.findMany({
    where: { userId: user.id, ...(favorite ? { favorite: true } : {}) },
    orderBy: { updatedAt: 'desc' },
  });
  return NextResponse.json({ conversations: rows.map(rowToListView) });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let rec;
  try {
    rec = conversationRecordSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: '参数错误' }, { status: 400 });
  }

  const data = {
    localId: rec.localId,
    npc: rec.npc ?? Prisma.JsonNull,
    mode: rec.mode,
    placeName: rec.placeName,
    country: rec.country,
    year: rec.year,
    month: rec.month,
    userLang: rec.userLang,
    summary: rec.summary,
    sensitiveReason: rec.sensitiveReason ?? null,
    interest: rec.interest ?? null,
    events: rec.events as unknown as Prisma.InputJsonValue,
    lat: rec.lat ?? null,
    lng: rec.lng ?? null,
    messages: rec.messages as unknown as Prisma.InputJsonValue,
    state: (rec.state as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    favorite: rec.favorite,
  };

  // 按 localId upsert:登录上传本地记录时幂等去重,不会重复创建。
  const saved = await prisma.conversation.upsert({
    where: { localId: rec.localId },
    create: { ...data, userId: user.id },
    update: data,
  });
  return NextResponse.json({ conversation: rowToRecord(saved) });
}
