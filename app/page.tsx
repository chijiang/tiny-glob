'use client';

import { useCallback, useState } from 'react';
import GlobeView from '@/components/GlobeView';
import TimePicker from '@/components/TimePicker';
import EventBrief from '@/components/EventBrief';
import StatusOverlay from '@/components/StatusOverlay';
import NpcPanel from '@/components/NpcPanel';
import AuthButton from '@/components/AuthButton';
import AuthModal from '@/components/AuthModal';
import FriendsPanel, { FriendListItem } from '@/components/FriendsPanel';
import { useAuth } from '@/lib/auth-context';
import { ChatMessage, Npc, SessionMode, UserLang } from '@/lib/types';

type Phase = 'idle' | 'picking' | 'researching' | 'chatting';
type Coords = { lat: number; lng: number };
type FlyTarget = Coords & { nonce: number };

const USER_LANG: UserLang = 'zh'; // MVP 固定中文

export default function Page() {
  const { user, openAuthModal } = useAuth();

  const [phase, setPhase] = useState<Phase>('idle');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [marker, setMarker] = useState<Coords | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);

  const [placeName, setPlaceName] = useState('');
  const [country, setCountry] = useState('');
  const [summary, setSummary] = useState('');
  const [sensitiveReason, setSensitiveReason] = useState<string | undefined>(undefined);
  const [modeOptions, setModeOptions] = useState<SessionMode[] | null>(null);
  const [currentMode, setCurrentMode] = useState<SessionMode>('character');
  const [npc, setNpc] = useState<Npc | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [assistantStreaming, setAssistantStreaming] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [progressText, setProgressText] = useState('');

  // 朋友面板 / 收藏
  const [friendsPanelOpen, setFriendsPanelOpen] = useState(false);
  const [friendsCount, setFriendsCount] = useState<number | undefined>(undefined);
  const [savingFriend, setSavingFriend] = useState(false);
  const [friendSaved, setFriendSaved] = useState(false); // 当前会话是否已收藏(防止重复)
  const [resumeFriendId, setResumeFriendId] = useState<string | null>(null); // 当前会话来自哪位朋友

  // 列表加载/删除时回传最新数量;用 useCallback 保证 FriendsPanel.load 标识稳定。
  const handleFriendsChanged = useCallback((count: number) => {
    setFriendsCount(count);
  }, []);

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
    setNpc(null);
    setSessionId(null);
    setMessages([]);
    setAssistantStreaming('');
    setSensitiveReason(undefined);
    setModeOptions(null);
    setCurrentMode('character');
    setError(null);
    setProgressText('');
    setFriendSaved(false);
    setResumeFriendId(null);
  };

  async function startResearch(year: number, month: number) {
    if (!coords) return;
    setPhase('researching');
    setSummary('');
    setNpc(null);
    setSensitiveReason(undefined);
    setModeOptions(null);
    setCurrentMode('character');
    setMessages([]);
    setError(null);
    setProgressText('');
    setFriendSaved(false);
    setResumeFriendId(null);

    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...coords, year, month, userLang: USER_LANG }),
      });
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
    setMessages((m) => [...m, { role: 'user', content: text }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, userMessage: text }),
      });
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
      }
      setAssistantStreaming('');
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
    } catch (e: any) {
      setError(e?.message ?? '切换出错');
    } finally {
      setChatBusy(false);
    }
  }

  // 收藏当前会话为朋友。未登录 → 打开登录弹窗,登录成功后自动重试。
  async function saveFriend() {
    if (!sessionId) return;
    if (!user) {
      openAuthModal(() => saveFriend());
      return;
    }
    setSavingFriend(true);
    setError(null);
    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setError('朋友数量已达上限(3 位),请先移除一些再收藏。');
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? '收藏失败');
      setFriendSaved(true);
      setResumeFriendId(data.friend?.id ?? null);
      setFriendsCount((c) => (typeof c === 'number' ? c + 1 : c));
    } catch (e: any) {
      setError(e?.message ?? '收藏出错');
    } finally {
      setSavingFriend(false);
    }
  }

  // 从朋友列表恢复一段历史会话:地球飞行 + NPC + 历史 + 模式信息全部载入。
  async function resumeFriend(f: FriendListItem) {
    setFriendsPanelOpen(false);
    setChatBusy(true);
    setError(null);
    setAssistantStreaming('');
    setFriendSaved(true); // 已是朋友,无需重复收藏
    setResumeFriendId(f.id);
    try {
      const res = await fetch(`/api/friends/${f.id}/resume`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? '恢复朋友失败');

      const c: Coords = { lat: f.lat ?? 0, lng: f.lng ?? 0 };
      setMarker(c);
      if (f.lat != null && f.lng != null) {
        setFlyTo({ lat: f.lat, lng: f.lng, nonce: Date.now() });
      }
      setPlaceName(f.placeName);
      setCountry(f.country);
      setSummary('');
      setNpc(data.npc ?? null);
      setCurrentMode(data.mode ?? f.mode);
      setMessages(data.messages ?? []);
      setModeOptions(data.modeOptions ?? null);
      setSensitiveReason(data.sensitiveReason);
      setSessionId(data.sessionId);
      setCoords(c);
      setPhase('chatting');
    } catch (e: any) {
      setError(e?.message ?? '恢复出错');
    } finally {
      setChatBusy(false);
    }
  }

  const showBrief = phase === 'researching' || phase === 'chatting';

  return (
    <main className="app" data-phase={phase}>
      <GlobeView onPick={handlePick} marker={marker} flyTo={flyTo} />

      <div className="brand">
        <span className="brand-dot" />
        TinyGlob
      </div>

      <div className="auth-slot">
        <AuthButton
          onOpenFriends={() => setFriendsPanelOpen(true)}
          friendsCount={friendsCount}
          onFriendsCount={handleFriendsChanged}
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
          brief={{ placeName, country, text: summary }}
          onSend={sendChat}
          onClose={reset}
          onSwitchMode={modeOptions ? handleSwitchMode : undefined}
          canSaveFriend={!!user && !!npc}
          onSaveFriend={saveFriend}
          savingFriend={savingFriend}
          friendSaved={friendSaved}
        />
      )}

      <FriendsPanel
        open={friendsPanelOpen}
        onClose={() => setFriendsPanelOpen(false)}
        onResume={resumeFriend}
        onChanged={handleFriendsChanged}
      />

      <AuthModal />
    </main>
  );
}
