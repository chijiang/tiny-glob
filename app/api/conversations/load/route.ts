import { NextRequest, NextResponse } from 'next/server';
import { conversationRecordSchema, sessionFromConversation } from '@/lib/conversations';
import { saveSession } from '@/lib/runtime-state';
import { getUserFromRequest, resolveGuest, setGuestCookie } from '@/lib/auth';
import { countRounds } from '@/lib/guest-policy';

export const runtime = 'nodejs';

/**
 * 由前端持有的完整 ConversationRecord 重建服务端 SessionState,返回 sessionId。
 * 之后 /api/chat、/api/chat-mode 零改动复用。本地(localStorage)与服务端记录走同一路径。
 * 匿名也可调用;不写库,仅在内存建会话。
 * 访客恢复的会话同样带 guestId/guestTurns,故轮数限制在 resume 后仍然生效。
 */
export async function POST(req: NextRequest) {
  let rec;
  try {
    rec = conversationRecordSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: '参数错误' }, { status: 400 });
  }

  const sessionId = crypto.randomUUID();
  const state = sessionFromConversation(rec, sessionId);

  // 未登录恢复 → 视为访客,挂上身份与已用轮数(按历史 user 消息计)。
  const user = await getUserFromRequest(req);
  let guestCookieToken: string | null = null;
  if (!user) {
    const g = await resolveGuest(req);
    state.guestId = g.guestId;
    state.guestTurns = countRounds(rec.messages);
    guestCookieToken = g.token;
  }

  saveSession(state);

  const res = NextResponse.json({ sessionId });
  if (guestCookieToken) setGuestCookie(res, guestCookieToken);
  return res;
}
