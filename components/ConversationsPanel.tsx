'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getStore } from '@/lib/conversation-store';
import { ConversationListItem, SessionMode } from '@/lib/types';

export type { ConversationListItem } from '@/lib/types';

type Props = {
  open: boolean;
  onClose: () => void;
  onResume: (item: ConversationListItem) => void;
  /** 列表加载/变更后回调,参数为对话总数(用于刷新角标) */
  onChanged?: (count: number) => void;
};

const MODE_LABEL: Record<SessionMode, string> = {
  character: '角色',
  bystander: '旁观者',
  lecturer: '讲解员',
};

export default function ConversationsPanel({ open, onClose, onResume, onChanged }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [favOnly, setFavOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await getStore(user).list(false);
      setItems(all);
      onChangedRef.current?.(all.length);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  const shown = favOnly ? items.filter((i) => i.favorite) : items;

  const del = async (id: string) => {
    if (!confirm('确定删除这段对话?历史消息将一并删除。')) return;
    setBusyId(id);
    try {
      await getStore(user).delete(id);
      setItems((prev) => {
        const next = prev.filter((i) => i.id !== id);
        onChangedRef.current?.(next.length);
        return next;
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="friends-panel">
      <div className="friends-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          对话历史 ({items.length})
          <button
            onClick={() => setFavOnly((v) => !v)}
            className="mode-switch"
            style={{ height: 22, padding: '0 8px' }}
            title="只看收藏"
          >
            {favOnly ? '★ 收藏' : '☆ 收藏'}
          </button>
        </span>
        <button className="close" onClick={onClose} title="关闭">×</button>
      </div>
      <div className="friends-list">
        {loading && <div className="friends-empty">加载中…</div>}
        {!loading && shown.length === 0 && (
          <div className="friends-empty">
            {favOnly ? '还没有收藏的对话。' : '还没有对话记录。'} <br />
            在地球上选个地点和时间,聊几句就会自动保存。
          </div>
        )}
        {shown.map((c) => (
          <div key={c.id} className="friend-item">
            <button className="friend-main" onClick={() => onResume(c)} disabled={busyId === c.id}>
              <div className="friend-avatar" title={c.favorite ? '已收藏' : ''}>
                {c.favorite ? '★' : c.npc ? c.npc.name.slice(0, 1) : '讲'}
              </div>
              <div className="friend-info">
                <div className="friend-name">
                  {c.npc ? `${c.npc.name} · ${c.npc.age}岁 · ${c.npc.occupation}` : `历史讲解员 · ${c.placeName}`}
                </div>
                <div className="friend-meta">
                  {c.npc ? c.placeName + ' · ' : ''}
                  {c.year}年{c.month}月 · {MODE_LABEL[c.mode]} · {c.messageCount} 条
                </div>
              </div>
            </button>
            <button
              className="friend-del"
              onClick={() => del(c.id)}
              disabled={busyId === c.id}
              title="删除"
            >
              {busyId === c.id ? '…' : '×'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
