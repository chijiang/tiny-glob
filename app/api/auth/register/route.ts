import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword, setSessionCookie, signToken } from '@/lib/auth';

export const runtime = 'nodejs';

const Body = z.object({
  email: z.string().email().max(200),
  password: z.string().min(6).max(200),
});

export async function POST(req: NextRequest) {
  let input;
  try {
    input = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: '邮箱或密码格式不正确' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (existing) {
    return NextResponse.json({ error: '该邮箱已注册' }, { status: 409 });
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: { email: input.email.toLowerCase(), passwordHash },
    select: { id: true, email: true },
  });

  const token = await signToken({ userId: user.id, email: user.email });
  const res = NextResponse.json({ id: user.id, email: user.email });
  setSessionCookie(res, token);
  return res;
}
