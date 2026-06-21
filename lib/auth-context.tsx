'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { uploadLocal } from './conversation-store';

type AuthUser = { id: string; email: string };

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  authModalOpen: boolean;
  pendingAction: (() => Promise<void> | void) | null;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** 打开登录弹窗;可选传入登录成功后要重试的动作(如收藏朋友) */
  openAuthModal: (after?: () => Promise<void> | void) => void;
  closeAuthModal: () => void;
  /** 登录成功后清掉并执行 pending action */
  consumePending: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void> | void) | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      setUser(data && data.id ? data : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? '登录失败');
    setUser({ id: data.id, email: data.email });
    // 登录后把本地(localStorage)对话上传合并到服务端(best-effort,不阻断登录)
    void uploadLocal().catch(() => {});
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? '注册失败');
    setUser({ id: data.id, email: data.email });
    void uploadLocal().catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  const openAuthModal = useCallback((after?: () => Promise<void> | void) => {
    setPendingAction(after ? () => after : null);
    setAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModalOpen(false);
    setPendingAction(null);
  }, []);

  const consumePending = useCallback(() => {
    setAuthModalOpen(false);
    const action = pendingAction;
    setPendingAction(null);
    if (action) action();
  }, [pendingAction]);

  const value: AuthContextValue = {
    user,
    loading,
    authModalOpen,
    pendingAction,
    refresh,
    login,
    register,
    logout,
    openAuthModal,
    closeAuthModal,
    consumePending,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
