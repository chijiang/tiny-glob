import { NextRequest, NextResponse } from 'next/server';
import { conversationRecordSchema, sessionFromConversation } from '@/lib/conversations';
import { saveSession } from '@/lib/runtime-state';

export const runtime = 'nodejs';

/**
 * 由前端持有的完整 ConversationRecord 重建服务端 SessionState,返回 sessionId。
 * 之后 /api/chat、/api/chat-mode 零改动复用。本地(localStorage)与服务端记录走同一路径。
 * 匿名也可调用;不写库,仅在内存建会话。
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
  saveSession(state);
  return NextResponse.json({ sessionId });
}
