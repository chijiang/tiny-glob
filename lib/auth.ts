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

// ============ 简易后台管理员 ============

const ADMIN_COOKIE = 'tg_admin';
const ADMIN_MAX_AGE_SEC = 60 * 60 * 12; // 12 小时

export async function signAdminToken(): Promise<string> {
  return new SignJWT({ admin: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_MAX_AGE_SEC}s`)
    .sign(secretKey());
}

export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    return payload.admin === true;
  } catch {
    return false;
  }
}

export function setAdminCookie(res: NextResponse, token: string): void {
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_MAX_AGE_SEC,
  });
}

export function clearAdminCookie(res: NextResponse): void {
  res.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

/** 请求是否带有效管理员 cookie。后台所有 API 用它鉴权。 */
export async function isAdminRequest(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  return verifyAdminToken(token);
}

/** 校验管理员账号/密码。凭证存 DB Setting(admin.username / admin.passwordHash),
 *  不用 env——避免 Next 加载 .env 时把 bcrypt 哈希里的 $ 当变量展开而损坏。 */
export async function verifyAdminCredentials(username: string, password: string): Promise<boolean> {
  try {
    const [u, h] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'admin.username' } }),
      prisma.setting.findUnique({ where: { key: 'admin.passwordHash' } }),
    ]);
    if (!u?.value || !h?.value) return false;
    if (username !== u.value) return false;
    return bcrypt.compare(password, h.value);
  } catch {
    return false;
  }
}

/** 修改管理员密码:先校验当前密码,再写入新 bcrypt 哈希。 */
export async function changeAdminPassword(
  current: string,
  next: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const h = await prisma.setting.findUnique({ where: { key: 'admin.passwordHash' } });
    if (!h?.value) return { ok: false, error: '管理员凭证未初始化' };
    if (!(await bcrypt.compare(current, h.value))) return { ok: false, error: '当前密码不正确' };
    const newHash = await bcrypt.hash(next, 10);
    await prisma.setting.upsert({
      where: { key: 'admin.passwordHash' },
      create: { key: 'admin.passwordHash', value: newHash },
      update: { value: newHash },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: '修改失败' };
  }
}

export { ADMIN_COOKIE };

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
