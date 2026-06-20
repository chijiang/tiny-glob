import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { setSessionCookie, signToken, verifyPassword } from '@/lib/auth';

export const runtime = 'nodejs';

const Body = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  let input;
  try {
    input = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: '邮箱或密码格式不正确' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    return NextResponse.json({ error: '邮箱或密码错误' }, { status: 401 });
  }

  const token = await signToken({ userId: user.id, email: user.email });
  const res = NextResponse.json({ id: user.id, email: user.email });
  setSessionCookie(res, token);
  return res;
}
