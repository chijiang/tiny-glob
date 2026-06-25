'use client';

import { useEffect, useRef, useState } from 'react';
import { ChatMessage, Npc, NpcState, SessionMode } from '@/lib/types';
import { DIMENSIONS, UNLOCK_AFFINITY, deriveMood } from '@/lib/npc-state';

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
  /** 失败的用户消息点"重试":仅 failed 的消息会出现重试按钮,正常消息不会。 */
  onRetry?: (messageId: string) => void;
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
  /** NPC 当前状态(8 维)。仅 character/bystander 有;lecturer 无。 */
  state?: NpcState | null;
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
  onRetry,
  onClose,
  onSwitchMode,
  favorite,
  onToggleFavorite,
  brief,
  guest,
  guestRoundMax,
  guestRoundUsed,
  notice,
  state,
}: Props) {
  const [input, setInput] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  // 访客已用轮数:优先用页面给的权威值(模式切换不重置);否则按消息推算。
  const guestRounds =
    guest && guestRoundMax
      ? (guestRoundUsed ?? messages.filter((m) => m.role === 'user').length)
      : 0;
  const inputDisabled = busy || !!notice;

  // ===== 状态面板派生 =====
  // 仅在有 NPC 的角色/旁观者模式展示;讲解员无状态。
  const showState = !!npc && !!state;
  const mood = state ? deriveMood(state) : null;
  const unlocked = !!state && state.affinity >= UNLOCK_AFFINITY;
  // 事件型维度(calm/vulnerability/gratitude/curiosity):仅当极值(≤2 或 ≥9)时才给玩家"察觉到"的提示。
  const extremeDims = showState && state
    ? DIMENSIONS.filter((d) => d.tier === 'event' && (state[d.key] <= 2 || state[d.key] >= 9))
    : [];
  // 心声(perception):好感够高、或对方向你袒露时,才显示 ta 的内心看法。
  const showPerception =
    showState && state && state.perception && (unlocked || state.vulnerability >= 8);

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
            <div className="npc-name">
              {npc.name}
              {mood && <span className="npc-mood-emoji" title={`心情:${mood.label}`}>{mood.emoji}</span>}
              {npc.rarity && (
                <span className="rare-badge" title={npc.rarity.flavor}>✦ {npc.rarity.label}</span>
              )}
            </div>
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

      {showState && state && mood && (
        <div className="npc-state">
          <div className="npc-state-row">
            <span className="npc-mood">{mood.emoji} {mood.label}</span>
            <span className="npc-state-hint" title="与 ta 越亲近,越能读懂 ta">
              {unlocked ? '已读懂 ta 几分' : '多聊聊,才能读懂 ta'}
            </span>
          </div>
          <StateBar label="好感" value={state.affinity} />
          {unlocked && <StateBar label="信任" value={state.trust} />}
          {unlocked && <StateBar label="尊敬" value={state.respect} />}
          {extremeDims.length > 0 && (
            <div className="npc-state-chips">
              {extremeDims.map((d) => {
                const v = state[d.key];
                const pole = v >= 9 ? d.high : d.low;
                return (
                  <span key={d.key} className="npc-state-chip">
                    {d.label}·{pole}
                  </span>
                );
              })}
            </div>
          )}
          {showPerception && (
            <div className="npc-perception">
              <span className="npc-perception-label">心声</span>
              {state.perception}
            </div>
          )}
        </div>
      )}

      <div className="chat-log" ref={logRef}>
        {messages.map((m, i) => (
          <div key={m.id ?? i} className={`bubble ${m.role}${m.failed ? ' failed' : ''}`}>
            {m.content}
            {m.role === 'user' && m.failed && (
              <div className="bubble-failed">
                <span className="bubble-failed-text">发送失败</span>
                {m.id && onRetry && (
                  <button
                    className="bubble-retry"
                    onClick={() => onRetry(m.id!)}
                    disabled={busy}
                    title="重新发送这条消息"
                  >
                    重试
                  </button>
                )}
              </div>
            )}
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

/** 1-10 数值的小进度条 + 标签。 */
function StateBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, (value / 10) * 100));
  return (
    <div className="npc-state-bar">
      <span className="npc-state-bar-label">{label}</span>
      <span className="npc-state-bar-track">
        <span className="npc-state-bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="npc-state-bar-value">{value}</span>
    </div>
  );
}
