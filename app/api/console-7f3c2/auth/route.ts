import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAdminCredentials, signAdminToken, setAdminCookie, clearAdminCookie } from '@/lib/auth';

export const runtime = 'nodejs';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('login'), username: z.string().min(1).max(100), password: z.string().min(1).max(200) }),
  z.object({ action: z.literal('logout') }),
]);

export async function POST(req: NextRequest) {
  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: '参数错误' }, { status: 400 });
  }

  if (body.action === 'logout') {
    const res = NextResponse.json({ ok: true });
    clearAdminCookie(res);
    return res;
  }

  const ok = await verifyAdminCredentials(body.username, body.password);
  if (!ok) return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
  const token = await signAdminToken();
  const res = NextResponse.json({ ok: true });
  setAdminCookie(res, token);
  return res;
}
