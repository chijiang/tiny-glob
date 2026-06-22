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
  /** ☆ 收藏切换(匿名也能用,存本地);讲师模式亦可收藏 */
  favorite: boolean;
  onToggleFavorite?: () => void;
  /** 历史简介(手机端聊天时并入面板顶部展示;桌面端由左下 EventBrief 独立显示,CSS 隐藏此块) */
  brief?: { placeName: string; country: string; text: string } | null;
  /** 访客模式:展示轮数徽章;guestRoundMax 给出上限。 */
  guest?: boolean;
  guestRoundMax?: number;
  guestRoundUsed?: number; // 权威已用轮数(页面维护,模式切换不重置);省略则按消息推算
  /** 锁定提示条(如访客达轮数上限):展示时禁用输入并提供可选动作。 */
  notice?: { text: string; actionLabel?: string; onAction?: () => void };
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
  favorite,
  onToggleFavorite,
  brief,
  guest,
  guestRoundMax,
  guestRoundUsed,
  notice,
}: Props) {
  const [input, setInput] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  // 访客已用轮数:优先用页面给的权威值(模式切换不重置);否则按消息推算。
  const guestRounds =
    guest && guestRoundMax
      ? (guestRoundUsed ?? messages.filter((m) => m.role === 'user').length)
      : 0;
  const inputDisabled = busy || !!notice;

  // 新消息到达时把对话区滚到底部。
  // 注意:只能滚动 .chat-log 自身,绝不能用 scrollIntoView —— 它会顺带滚动
  // .app(overflow:hidden 仍是可编程滚动容器),把整个浮层(npc 面板/事件简述)
  // 一起顶上去,导致面板顶部被裁、底部留出黑边。
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
  }, [messages, assistantStreaming]);

  const send = () => {
    const t = input.trim();
    if (!t || inputDisabled) return;
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
          {onToggleFavorite && (
            <button
              className="friend-save"
              onClick={onToggleFavorite}
              disabled={busy}
              title={favorite ? '取消收藏' : '收藏'}
            >
              {favorite ? '★' : '☆'}
            </button>
          )}
          <button className="close" onClick={onClose} title="关闭对话">
            ×
          </button>
        </div>
      </div>

      {brief && (
        <div className="npc-brief">
          <div className="place">
            {brief.placeName}
            {brief.country ? `, ${brief.country}` : ''}
          </div>
          <div className="summary">{brief.text || '正在查阅资料…'}</div>
        </div>
      )}

      <div className="chat-log" ref={logRef}>
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        {assistantStreaming !== '' && (
          <div className="bubble assistant">{assistantStreaming}</div>
        )}
      </div>

      <div className="chat-input">
        {notice ? (
          <div className="chat-notice">
            <span className="chat-notice-text">{notice.text}</span>
            {notice.actionLabel && notice.onAction && (
              <button className="chat-notice-action" onClick={notice.onAction}>
                {notice.actionLabel}
              </button>
            )}
          </div>
        ) : guest && guestRoundMax ? (
          <div className="guest-meter">
            访客模式 · 第 {Math.min(guestRounds + (busy ? 1 : 0), guestRoundMax)} / {guestRoundMax} 轮
          </div>
        ) : null}
        <div className="chat-input-row">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            placeholder={npc ? `对 ${npc.name} 说点什么…` : '提个问题…'}
            disabled={inputDisabled}
          />
          <button onClick={send} disabled={inputDisabled || !input.trim()}>
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
