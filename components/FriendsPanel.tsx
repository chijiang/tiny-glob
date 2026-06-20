'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type FriendListItem = {
  id: string;
  name: string;
  age: number;
  gender: string;
  occupation: string;
  placeName: string;
  country: string;
  year: number;
  month: number;
  mode: string;
  messageCount: number;
  createdAt: string;
  lat: number | null;
  lng: number | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onResume: (friend: FriendListItem) => void;
  /** 列表加载/变更后回调,参数为最新朋友数(用于刷新按钮角标) */
  onChanged?: (count: number) => void;
};

export default function FriendsPanel({ open, onClose, onResume, onChanged }: Props) {
  const [friends, setFriends] = useState<FriendListItem[]>([]);
  const [max, setMax] = useState(3);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // 用 ref 装 onChanged,避免 callback 标识变化触发 effect 死循环。
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/friends');
      if (!res.ok) return;
      const data = await res.json();
      setFriends(data.friends ?? []);
      setMax(data.max ?? 3);
      onChangedRef.current?.(data.friends?.length ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  const del = async (id: string) => {
    if (!confirm('确定移除这位朋友?历史对话将一并删除。')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/friends/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setFriends((prev) => {
          const next = prev.filter((f) => f.id !== id);
          onChangedRef.current?.(next.length);
          return next;
        });
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="friends-panel">
      <div className="friends-header">
        <span>我的朋友 ({friends.length}/{max})</span>
        <button className="close" onClick={onClose} title="关闭">×</button>
      </div>
      <div className="friends-list">
        {loading && <div className="friends-empty">加载中…</div>}
        {!loading && friends.length === 0 && (
          <div className="friends-empty">
            还没有保存的朋友。<br />
            在对话中点 ☆ 把一位角色收藏为朋友吧。
          </div>
        )}
        {friends.map((f) => (
          <div key={f.id} className="friend-item">
            <button className="friend-main" onClick={() => onResume(f)} disabled={busyId === f.id}>
              <div className="friend-avatar">{f.name.slice(0, 1)}</div>
              <div className="friend-info">
                <div className="friend-name">
                  {f.name} · {f.age}岁 · {f.occupation}
                </div>
                <div className="friend-meta">
                  {f.placeName} · {f.year}年{f.month}月 · {f.messageCount} 条对话
                </div>
              </div>
            </button>
            <button
              className="friend-del"
              onClick={() => del(f.id)}
              disabled={busyId === f.id}
              title="移除"
            >
              {busyId === f.id ? '…' : '×'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
