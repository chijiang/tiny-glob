'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getStore } from '@/lib/conversation-store';

type Props = {
  onOpenHistory?: () => void;
  historyCount?: number;
  onHistoryCount?: (count: number) => void;
};

export default function AuthButton({ onOpenHistory, historyCount, onHistoryCount }: Props) {
  const { user, loading, openAuthModal, logout } = useAuth();

  // 登录用户:拉服务端对话数;匿名:读本地(localStorage)对话数。
  // 列表内的增删通过 onHistoryCount 回传,这里只负责初始/登录态切换时刷一次。
  useEffect(() => {
    if (loading || !onHistoryCount) return;
    let cancelled = false;
    (user
      ? fetch('/api/conversations').then((r) => (r.ok ? r.json() : null))
      : getStore(null).list(false)
    )
      .then((d: any) => {
        if (cancelled) return;
        const n = user ? (d?.conversations?.length ?? 0) : (d?.length ?? 0);
        onHistoryCount(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, loading, onHistoryCount]);

  if (loading) return null;

  return (
    <div className="auth-logged">
      {onOpenHistory && (
        <button className="friends-trigger" onClick={onOpenHistory}>
          历史{typeof historyCount === 'number' ? ` (${historyCount})` : ''}
        </button>
      )}
      {user ? (
        <>
          <span className="auth-email" title={user.email}>{user.email}</span>
          <button className="auth-logout" onClick={logout}>退出</button>
        </>
      ) : (
        <>
          <span className="auth-guest-tag" title="你正在以访客身份体验,用量受限">访客</span>
          <button className="auth-trigger" onClick={() => openAuthModal()}>
            登录 / 注册
          </button>
        </>
      )}
    </div>
  );
}
