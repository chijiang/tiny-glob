import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  return NextResponse.json(user ? { id: user.id, email: user.email } : null);
}
