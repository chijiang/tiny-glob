import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { changeAdminPassword, isAdminRequest } from '@/lib/auth';

export const runtime = 'nodejs';

async function adminOr401(req: NextRequest): Promise<NextResponse | null> {
  if (await isAdminRequest(req)) return null;
  return NextResponse.json({ error: '未授权' }, { status: 401 });
}

/** GET:读取稀遇概率 + 全部稀遇原型(后台展示)。仅管理员。 */
export async function GET(req: NextRequest) {
  const fail = await adminOr401(req);
  if (fail) return fail;
  const [probRow, archetypes] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'npc.rareProbability' } }),
    prisma.hiddenArchetype.findMany({ orderBy: { key: 'asc' } }),
  ]);
  return NextResponse.json({
    probability: probRow?.value ?? '0.04',
    archetypes: archetypes.map((a) => ({
      id: a.id,
      key: a.key,
      label: a.label,
      flavor: a.flavor,
      directive: a.directive,
      stateOverride: a.stateOverride,
      weight: a.weight,
      enabled: a.enabled,
    })),
  });
}

const MutBody = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('setSetting'),
    key: z.string().min(1).max(100),
    value: z.string().min(1).max(500),
  }),
  z.object({ op: z.literal('toggleArchetype'), key: z.string().min(1), enabled: z.boolean() }),
  z.object({ op: z.literal('setArchetypeWeight'), key: z.string().min(1), weight: z.number().int().min(0).max(100) }),
  z.object({
    op: z.literal('upsertArchetype'),
    key: z.string().min(1).max(60),
    label: z.string().min(1).max(60),
    flavor: z.string().min(1).max(300),
    directive: z.string().min(1).max(4000),
    stateOverride: z.record(z.string(), z.any()).optional().nullable(),
    weight: z.number().int().min(0).max(100).default(1),
    enabled: z.boolean().default(true),
  }),
  z.object({ op: z.literal('deleteArchetype'), key: z.string().min(1) }),
  z.object({
    op: z.literal('changeAdminPassword'),
    current: z.string().min(1).max(200),
    next: z.string().min(8).max(200),
  }),
]);

/** POST:op 联合的若干写操作。仅管理员。 */
export async function POST(req: NextRequest) {
  const fail = await adminOr401(req);
  if (fail) return fail;
  let body;
  try {
    body = MutBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: '参数错误' }, { status: 400 });
  }

  switch (body.op) {
    case 'setSetting': {
      if (body.key === 'npc.rareProbability') {
        const p = Number(body.value);
        if (!Number.isFinite(p) || p < 0 || p > 1) {
          return NextResponse.json({ error: '概率须为 0–1 之间的数' }, { status: 400 });
        }
      }
      await prisma.setting.upsert({
        where: { key: body.key },
        create: { key: body.key, value: body.value },
        update: { value: body.value },
      });
      return NextResponse.json({ ok: true });
    }
    case 'toggleArchetype':
      await prisma.hiddenArchetype.updateMany({ where: { key: body.key }, data: { enabled: body.enabled } });
      return NextResponse.json({ ok: true });
    case 'setArchetypeWeight':
      await prisma.hiddenArchetype.updateMany({ where: { key: body.key }, data: { weight: body.weight } });
      return NextResponse.json({ ok: true });
    case 'upsertArchetype': {
      const data = {
        key: body.key,
        label: body.label,
        flavor: body.flavor,
        directive: body.directive,
        stateOverride: (body.stateOverride as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        weight: body.weight,
        enabled: body.enabled,
      };
      await prisma.hiddenArchetype.upsert({ where: { key: body.key }, create: data, update: data });
      return NextResponse.json({ ok: true });
    }
    case 'deleteArchetype':
      await prisma.hiddenArchetype.deleteMany({ where: { key: body.key } });
      return NextResponse.json({ ok: true });
    case 'changeAdminPassword': {
      const r = await changeAdminPassword(body.current, body.next);
      if (!r.ok) return NextResponse.json({ error: r.error ?? '修改失败' }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
  }
}
