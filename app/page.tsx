'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import GlobeView from '@/components/GlobeView';
import TimePicker from '@/components/TimePicker';
import EventBrief from '@/components/EventBrief';
import StatusOverlay from '@/components/StatusOverlay';
import NpcPanel from '@/components/NpcPanel';
import AuthButton from '@/components/AuthButton';
import AuthModal from '@/components/AuthModal';
import ConversationsPanel, { ConversationListItem } from '@/components/ConversationsPanel';
import { useAuth } from '@/lib/auth-context';
import { getStore } from '@/lib/conversation-store';
import { MAX_GUEST_ROUNDS, countRounds } from '@/lib/guest-policy';
import { ChatMessage, ConversationRecord, Npc, SessionMode, UserLang, WikiEvent } from '@/lib/types';

type Phase = 'idle' | 'picking' | 'researching' | 'chatting';
type Coords = { lat: number; lng: number };
type FlyTarget = Coords & { nonce: number };
type GlobeTheme = 'day' | 'night';

const USER_LANG: UserLang = 'zh'; // MVP 固定中文
const GLOBE_THEME_KEY = 'tg.globe-theme.v1';

export default function Page() {
  const { user, forceAuth } = useAuth();

  const [phase, setPhase] = useState<Phase>('idle');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [marker, setMarker] = useState<Coords | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);

  const [placeName, setPlaceName] = useState('');
  const [country, setCountry] = useState('');
  const [summary, setSummary] = useState('');
  const [events, setEvents] = useState<WikiEvent[]>([]);
  const [year, setYear] = useState(0);
  const [month, setMonth] = useState(0);
  const [sensitiveReason, setSensitiveReason] = useState<string | undefined>(undefined);
  const [modeOptions, setModeOptions] = useState<SessionMode[] | null>(null);
  const [currentMode, setCurrentMode] = useState<SessionMode>('character');
  const [npc, setNpc] = useState<Npc | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [favorite, setFavorite] = useState(false);
  const [interest, setInterest] = useState('');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [assistantStreaming, setAssistantStreaming] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [progressText, setProgressText] = useState('');

  // 历史面板 / 计数角标
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyCount, setHistoryCount] = useState<number | undefined>(undefined);

  // 访客配额:本次开启后还能开启的对话数(research 下发);null=未知/非访客。
  const [guestRemaining, setGuestRemaining] = useState<number | null>(null);
  // 访客本段对话已用轮数(权威,模式切换不重置;与服务端 session.guestTurns 对齐)。
  const [guestTurnsUsed, setGuestTurnsUsed] = useState(0);
  const [globeTheme, setGlobeTheme] = useState<GlobeTheme>('night');

  const handleHistoryChanged = useCallback((count: number) => {
    setHistoryCount(count);
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(GLOBE_THEME_KEY);
      if (saved === 'day' || saved === 'night') setGlobeTheme(saved);
    } catch {
      /* 读配置失败时回退默认夜间 */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(GLOBE_THEME_KEY, globeTheme);
    } catch {
      /* 持久化失败不影响使用 */
    }
  }, [globeTheme]);

  const handlePick = (c: Coords) => {
    if (phase === 'researching' || phase === 'chatting') return;
    setCoords(c);
    setMarker(c);
    setPhase('picking');
  };

  const reset = () => {
    setPhase('idle');
    setCoords(null);
    setMarker(null);
    setPlaceName('');
    setCountry('');
    setSummary('');
    setEvents([]);
    setYear(0);
    setMonth(0);
    setNpc(null);
    setSessionId(null);
    setConversationId(null);
    setFavorite(false);
    setInterest('');
    setMessages([]);
    setAssistantStreaming('');
    setSensitiveReason(undefined);
    setModeOptions(null);
    setCurrentMode('character');
    setError(null);
    setProgressText('');
    setGuestRemaining(null);
    setGuestTurnsUsed(0);
  };

  async function startResearch(y: number, m: number, interestArg?: string) {
    if (!coords) return;
    setPhase('researching');
    setYear(y);
    setMonth(m);
    setInterest(interestArg ?? '');
    setSummary('');
    setEvents([]);
    setNpc(null);
    setConversationId(null);
    setFavorite(false);
    setSensitiveReason(undefined);
    setModeOptions(null);
    setCurrentMode('character');
    setMessages([]);
    setError(null);
    setProgressText('');
    setGuestRemaining(null);
    setGuestTurnsUsed(0);

    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...coords, year: y, month: m, userLang: USER_LANG, interest: interestArg }),
      });
      // 访客对话次数用尽:服务端返回 403 → 弹强制注册窗,停留在选点阶段。
      if (res.status === 403) {
        const data = await res.json().catch(() => ({} as any));
        if (data?.reason === 'guest_limit') {
          forceAuth('guest_limit');
          setPhase('picking');
          return;
        }
      }
      if (!res.ok || !res.body) throw new Error('查阅服务不可用');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawError = false;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let frame: any;
          try {
            frame = JSON.parse(line);
          } catch {
            continue;
          }
          switch (frame.type) {
            case 'place':
              setPlaceName(frame.name);
              setCountry(frame.country);
              break;
            case 'progress':
              setProgressText(frame.text);
              break;
            case 'summary_chunk':
              setSummary((s) => s + frame.text);
              break;
            case 'events':
              setEvents(frame.events);
              break;
            case 'sensitive':
              if (frame.value && frame.reason) setSensitiveReason(frame.reason);
              break;
            case 'npc':
              if ((frame.mode === 'character' || frame.mode === 'bystander') && frame.npc) {
                setNpc(frame.npc);
                setCurrentMode(frame.mode);
                setMessages([{ role: 'assistant', content: frame.npc.openingLine }]);
              } else {
                setNpc(null);
              }
              break;
            case 'modeOptions':
              setModeOptions(frame.options);
              break;
            case 'sessionId':
              setSessionId(frame.id);
              break;
            case 'guestQuota':
              setGuestRemaining(frame.remaining);
              break;
            case 'error':
              setError(frame.message);
              sawError = true;
              break;
            case 'done':
              break;
          }
        }
      }
      if (!sawError) setPhase('chatting');
      else setPhase('picking');
    } catch (e: any) {
      setError(e?.message ?? '查阅出错');
      setPhase('picking');
    }
  }

  async function sendChat(text: string) {
    if (!sessionId || chatBusy) return;
    setChatBusy(true);
    setAssistantStreaming('');

    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages((m) => [...m, userMsg]);

    // 持久化:首条用户消息 → 创建对话记录(含地区简介/事件/NPC 快照);否则追加用户消息。
    // best-effort,失败不阻断对话。
    let cid = conversationId;
    const openingLine = npc?.openingLine ?? '';
    try {
      if (!cid) {
        const now = new Date().toISOString();
        const rec: ConversationRecord = {
          localId: crypto.randomUUID(),
          npc,
          mode: currentMode,
          placeName,
          country,
          year,
          month,
          userLang: USER_LANG,
          summary,
          sensitiveReason,
          interest: interest || undefined,
          lat: coords?.lat,
          lng: coords?.lng,
          events,
          messages: [
            ...(openingLine ? [{ role: 'assistant' as const, content: openingLine }] : []),
            userMsg,
          ],
          favorite: false,
          createdAt: now,
          updatedAt: now,
        };
        const created = await getStore(user).create(rec);
        cid = created.id ?? null;
        if (cid) {
          setConversationId(cid);
          setHistoryCount((c) => (typeof c === 'number' ? c + 1 : 1));
        }
      } else {
        void getStore(user).appendMessage(cid, 'user', text);
      }
    } catch {
      /* 持久化失败不影响对话 */
    }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, userMessage: text }),
      });
      // 访客达轮数上限:回滚乐观消息并锁定本轮(权威计数顶到上限,触发锁定提示)。
      if (res.status === 403) {
        const data = await res.json().catch(() => ({} as any));
        if (data?.reason === 'guest_round_limit') {
          setMessages((m) => m.slice(0, -1)); // 去掉刚加的用户消息
          setAssistantStreaming('');
          setGuestTurnsUsed(MAX_GUEST_ROUNDS);
          return;
        }
      }
      if (!res.ok || !res.body) throw new Error('对话服务不可用');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setAssistantStreaming(acc);
      }
      if (acc.trim()) {
        setMessages((m) => [...m, { role: 'assistant', content: acc }]);
        if (cid) void getStore(user).appendMessage(cid, 'assistant', acc);
      }
      setAssistantStreaming('');
      // 一轮完成(用户已发言 + 收到回复):访客权威轮数 +1。
      if (!user) setGuestTurnsUsed((n) => n + 1);
    } catch (e: any) {
      setError(e?.message ?? '对话出错');
    } finally {
      setChatBusy(false);
    }
  }

  async function handleSwitchMode() {
    if (!sessionId || !modeOptions || chatBusy) return;
    const next: SessionMode = currentMode === 'bystander' ? 'lecturer' : 'bystander';
    setChatBusy(true);
    setAssistantStreaming('');
    try {
      const res = await fetch('/api/chat-mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, mode: next }),
      });
      if (!res.ok) throw new Error('模式切换失败');
      const data = await res.json();
      setCurrentMode(data.mode);
      setNpc(data.npc ?? null);
      setMessages(data.messages ?? []);
      // 模式切换会重置消息,同步到对话记录
      if (conversationId) {
        void getStore(user).updateMode(conversationId, data.mode, data.messages ?? []);
      }
    } catch (e: any) {
      setError(e?.message ?? '切换出错');
    } finally {
      setChatBusy(false);
    }
  }

  // ☆ 收藏切换(匿名也能用,存本地)
  async function toggleFavorite() {
    if (!conversationId) return;
    const next = !favorite;
    setFavorite(next);
    try {
      await getStore(user).toggleFavorite(conversationId);
    } catch {
      setFavorite(!next); // 回滚
    }
  }

  // 从历史记录恢复一段对话:地球飞行 + 全字段回填(含地区简介) + 服务端重建会话。
  async function resumeConversation(item: ConversationListItem) {
    setHistoryOpen(false);
    setChatBusy(true);
    setError(null);
    setAssistantStreaming('');
    try {
      const full = await getStore(user).get(item.id);
      if (!full) throw new Error('记录不存在或已删除');

      const c: Coords = { lat: full.lat ?? 0, lng: full.lng ?? 0 };
      setMarker(c);
      if (full.lat != null && full.lng != null) {
        setFlyTo({ lat: full.lat, lng: full.lng, nonce: Date.now() });
      }
      setPlaceName(full.placeName);
      setCountry(full.country);
      setSummary(full.summary); // ← 修复:恢复地区简介,不再显示「正在查阅资料…」
      setEvents(full.events);
      setInterest(full.interest ?? '');
      setYear(full.year);
      setMonth(full.month);
      setNpc(full.npc);
      setCurrentMode(full.mode);
      setMessages(full.messages);
      setModeOptions(full.mode === 'bystander' || full.mode === 'lecturer' ? ['bystander', 'lecturer'] : null);
      setSensitiveReason(full.sensitiveReason);
      setFavorite(full.favorite);
      setCoords(c);
      // 访客恢复:按历史 user 消息重建已用轮数(与服务端 session.guestTurns 一致)。
      setGuestTurnsUsed(user ? 0 : countRounds(full.messages));

      const res = await fetch('/api/conversations/load', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(full),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? '恢复失败');
      setSessionId(data.sessionId);
      setConversationId(full.id ?? null);
      setPhase('chatting');
    } catch (e: any) {
      setError(e?.message ?? '恢复出错');
    } finally {
      setChatBusy(false);
    }
  }

  const showBrief = phase === 'researching' || phase === 'chatting';

  // 访客在聊天阶段的轮数锁定:达上限 → 给出提示。若仍有可开启的对话 → 引导开新对话;
  // 否则(配额也已用尽)→ 引导注册。
  const isGuest = !user;
  const guestRoundLocked = isGuest && phase === 'chatting' && guestTurnsUsed >= MAX_GUEST_ROUNDS;
  const guestCanStartMore = typeof guestRemaining === 'number' ? guestRemaining > 0 : true;
  const guestNotice = guestRoundLocked
    ? guestCanStartMore
      ? { text: `访客每段对话限 ${MAX_GUEST_ROUNDS} 轮,本轮已结束。`, actionLabel: '开启新对话', onAction: reset }
      : { text: '访客可体验的对话次数已用完。', actionLabel: '注册解锁', onAction: () => forceAuth('guest_limit') }
    : undefined;

  // guest→user 过渡(访客在对话中注册/登录):当前会话建立在访客身份上,
  // 登录后应回到地球以登录身份重新开始(避免沿用受限量配的旧会话)。
  const prevUserRef = useRef(user);
  useEffect(() => {
    if (!prevUserRef.current && user && phase === 'chatting') {
      reset();
    }
    prevUserRef.current = user;
  }, [user, phase]);

  return (
    <main className="app" data-phase={phase}>
      <GlobeView onPick={handlePick} marker={marker} flyTo={flyTo} theme={globeTheme} />

      <div className="brand">
        <span className="brand-dot" />
        TinyGlob
      </div>

      <div className="auth-slot">
        <div className="globe-theme-switch" role="group" aria-label="地球纹理模式">
          <button
            className={globeTheme === 'day' ? 'active' : ''}
            aria-pressed={globeTheme === 'day'}
            onClick={() => setGlobeTheme('day')}
          >
            白天
          </button>
          <button
            className={globeTheme === 'night' ? 'active' : ''}
            aria-pressed={globeTheme === 'night'}
            onClick={() => setGlobeTheme('night')}
          >
            夜间
          </button>
        </div>
        <AuthButton
          onOpenHistory={() => setHistoryOpen(true)}
          historyCount={historyCount}
          onHistoryCount={handleHistoryChanged}
        />
      </div>

      {phase === 'idle' && <div className="hint-floating">在地球上点击一个地点开始</div>}

      {phase === 'picking' && coords && (
        <TimePicker onConfirm={startResearch} onCancel={reset} />
      )}

      {showBrief && <EventBrief placeName={placeName} country={country} text={summary} />}

      <StatusOverlay
        error={error}
        busy={phase === 'researching' || (phase === 'chatting' && chatBusy && assistantStreaming === '' && messages.length === 0)}
        progressText={progressText}
      />

      {phase === 'chatting' && sessionId && (
        <NpcPanel
          npc={npc}
          placeName={placeName}
          messages={messages}
          assistantStreaming={assistantStreaming}
          busy={chatBusy || assistantStreaming !== ''}
          switchable={!!modeOptions}
          currentMode={currentMode}
          sensitiveReason={sensitiveReason}
          favorite={favorite}
          onToggleFavorite={toggleFavorite}
          brief={{ placeName, country, text: summary }}
          onSend={sendChat}
          onClose={reset}
          onSwitchMode={modeOptions ? handleSwitchMode : undefined}
          guest={isGuest}
          guestRoundMax={isGuest ? MAX_GUEST_ROUNDS : undefined}
          guestRoundUsed={isGuest ? guestTurnsUsed : undefined}
          notice={guestNotice}
        />
      )}

      <ConversationsPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onResume={resumeConversation}
        onChanged={handleHistoryChanged}
      />

      <AuthModal />
    </main>
  );
}
