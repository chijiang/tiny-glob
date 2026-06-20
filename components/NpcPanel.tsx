'use client';

import { useEffect, useRef, useState } from 'react';
import { ChatMessage, Npc, SessionMode } from '@/lib/types';

type Props = {
  npc: Npc | null; // null = 讲解员模式
  placeName: string;
  messages: ChatMessage[];
  assistantStreaming: string; // 当前正在流式生成的文本
  busy: boolean;
  switchable?: boolean; // 敏感会话:允许 bystander↔lecturer 切换
  currentMode?: SessionMode; // 当前模式(决定切换按钮文案)
  sensitiveReason?: string; // 旁观者模式副标题展示
  onSend: (text: string) => void;
  onClose: () => void;
  onSwitchMode?: () => void;
  /** 收藏为朋友按钮:仅 npc 存在 + 用户已登录时显示 */
  canSaveFriend?: boolean;
  onSaveFriend?: () => void;
  savingFriend?: boolean;
  friendSaved?: boolean;
};

export default function NpcPanel({
  npc,
  placeName,
  messages,
  assistantStreaming,
  busy,
  switchable,
  currentMode,
  sensitiveReason,
  onSend,
  onClose,
  onSwitchMode,
  canSaveFriend,
  onSaveFriend,
  savingFriend,
  friendSaved,
}: Props) {
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, assistantStreaming]);

  const send = () => {
    const t = input.trim();
    if (!t || busy) return;
    onSend(t);
    setInput('');
  };

  const isLecturer = currentMode === 'lecturer';

  return (
    <div className="npc-panel">
      <div className="npc-header">
        {npc ? (
          <>
            <div className="npc-name">{npc.name}</div>
            <div className="npc-meta">
              {npc.age}岁 · {npc.gender} · {npc.occupation}
            </div>
            <div className="npc-meta">
              {npc.family} · {npc.personality}
            </div>
            {currentMode === 'bystander' && (
              <div className="npc-meta npc-bystander-tag">
                旁观者视角{ sensitiveReason ? ` · ${sensitiveReason}` : '' }
              </div>
            )}
          </>
        ) : (
          <>
            <div className="npc-name">历史讲解员</div>
            <div className="npc-meta">关于 {placeName} 的客观历史问答</div>
            {sensitiveReason && <div className="npc-meta npc-bystander-tag">{sensitiveReason}</div>}
          </>
        )}
        <div className="npc-header-actions">
          {switchable && onSwitchMode && (
            <button
              className="mode-switch"
              onClick={onSwitchMode}
              disabled={busy}
              title={isLecturer ? '切换为同代旁观者' : '切换为客观讲解员'}
            >
              {isLecturer ? '旁观者' : '讲解员'}
            </button>
          )}
          {canSaveFriend && onSaveFriend && npc && (
            <button
              className="friend-save"
              onClick={onSaveFriend}
              disabled={savingFriend || friendSaved || busy}
              title={friendSaved ? '已收藏' : '收藏为朋友'}
            >
              {savingFriend ? '…' : friendSaved ? '★' : '☆'}
            </button>
          )}
          <button className="close" onClick={onClose} title="关闭对话">
            ×
          </button>
        </div>
      </div>

      <div className="chat-log">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        {assistantStreaming !== '' && (
          <div className="bubble assistant">{assistantStreaming}</div>
        )}
        <div ref={endRef} />
      </div>

      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder={npc ? `对 ${npc.name} 说点什么…` : '提个问题…'}
          disabled={busy}
        />
        <button onClick={send} disabled={busy || !input.trim()}>
          发送
        </button>
      </div>
    </div>
  );
}
