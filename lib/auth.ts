import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from './prisma';

const COOKIE_NAME = 'tinyglob_token';
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 天

// 访客身份 cookie(未登录用户)。签名 JWT,httpOnly 防篡改。
const GUEST_COOKIE = 'tg_guest';
const GUEST_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 天

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET 未配置(请检查 .env)');
  return new TextEncoder().encode(s);
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export async function signToken(payload: { userId: string; email: string }): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SEC}s`)
    .sign(secretKey());
}

export async function verifyToken(token: string): Promise<{ userId: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    if (typeof payload.userId === 'string' && typeof payload.email === 'string') {
      return { userId: payload.userId, email: payload.email };
    }
    return null;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SEC,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(COOKIE_NAME, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

export function readTokenFromRequest(req: NextRequest): string | undefined {
  return req.cookies.get(COOKIE_NAME)?.value;
}

/**
 * 从请求 cookie 解析当前登录用户。API route 鉴权用。
 * 返回 null = 未登录(调用方自行决定 401 或放行)。
 */
export async function getUserFromRequest(req: NextRequest) {
  const token = readTokenFromRequest(req);
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true },
  });
  return user; // { id, email } | null
}

export { COOKIE_NAME };

// ============ 访客身份 ============

export async function signGuestToken(guestId: string): Promise<string> {
  return new SignJWT({ guestId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${GUEST_MAX_AGE_SEC}s`)
    .sign(secretKey());
}

export async function verifyGuestToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    return typeof payload.guestId === 'string' ? payload.guestId : null;
  } catch {
    return null;
  }
}

export function setGuestCookie(res: NextResponse, token: string): void {
  res.cookies.set(GUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: GUEST_MAX_AGE_SEC,
  });
}

/**
 * 解析或签发访客身份。未登录用户首次访问时签发新的 guestId,
 * 并返回待写入 cookie 的 token;cookie 已存在且有效则复用(token=null 表示无需重写)。
 */
export async function resolveGuest(req: NextRequest): Promise<{ guestId: string; token: string | null }> {
  const existing = req.cookies.get(GUEST_COOKIE)?.value;
  if (existing) {
    const guestId = await verifyGuestToken(existing);
    if (guestId) return { guestId, token: null };
  }
  const guestId = crypto.randomUUID();
  const token = await signGuestToken(guestId);
  return { guestId, token };
}

export { GUEST_COOKIE };
