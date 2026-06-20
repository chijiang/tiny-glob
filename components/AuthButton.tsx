'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

type Props = {
  onOpenFriends?: () => void;
  friendsCount?: number;
  onFriendsCount?: (count: number) => void;
};

export default function AuthButton({ onOpenFriends, friendsCount, onFriendsCount }: Props) {
  const { user, loading, openAuthModal, logout } = useAuth();

  // 用户从 null → 已登录时拉一次朋友数(刷新页面后角标也能立刻显示)。
  useEffect(() => {
    if (!user || !onFriendsCount) return;
    let cancelled = false;
    fetch('/api/friends')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.friends) onFriendsCount(d.friends.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, onFriendsCount]);

  if (loading) return null;

  if (!user) {
    return (
      <button className="auth-trigger" onClick={() => openAuthModal()}>
        登录 / 注册
      </button>
    );
  }

  return (
    <div className="auth-logged">
      {onOpenFriends && (
        <button className="friends-trigger" onClick={onOpenFriends}>
          朋友{typeof friendsCount === 'number' ? ` (${friendsCount})` : ''}
        </button>
      )}
      <span className="auth-email" title={user.email}>{user.email}</span>
      <button className="auth-logout" onClick={logout}>退出</button>
    </div>
  );
}
