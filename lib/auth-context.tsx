'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { uploadLocal } from './conversation-store';

type AuthUser = { id: string; email: string };

/**
 * 弹窗变体:
 * - gate:首次访问的访客门(可切登录/注册/访客,关闭=进入访客)
 * - action:登录态下的动作门(如收藏),只有登录/注册 + 关闭
 * - forced:访客用量用尽后的强制注册(不可关闭,无访客入口)
 */
type ModalVariant = 'gate' | 'action' | 'forced';
type ForceReason = 'guest_limit' | null;

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  /** 动作/强制弹窗是否打开(访客门由 showGate 派生,不占此位) */
  authModalOpen: boolean;
  modalVariant: ModalVariant;
  forceAuthReason: ForceReason;
  /** 派生:是否应展示访客门(加载完成 + 未登录 + 未选访客) */
  showGate: boolean;
  pendingAction: (() => Promise<void> | void) | null;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** 打开登录/注册弹窗(action 变体);可选传入登录成功后要重试的动作(如收藏) */
  openAuthModal: (after?: () => Promise<void> | void) => void;
  closeAuthModal: () => void;
  /** 登录成功后清掉并执行 pending action */
  consumePending: () => void;
  /** 进入访客模式(关闭访客门),记入 localStorage 不再弹门 */
  enterGuest: () => void;
  /** 访客用量用尽 → 弹强制注册窗(不可关闭) */
  forceAuth: (reason?: 'guest_limit') => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}

const GUEST_CHOSEN_KEY = 'tg.guestChosen';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [modalVariant, setModalVariant] = useState<ModalVariant>('action');
  const [forceAuthReason, setForceAuthReason] = useState<ForceReason>(null);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void> | void) | null>(null);
  // 访客门仅客户端有意义;用 typeof window 守卫避免 SSR/水合不一致(loading=true 时门本就不显示)。
  const [guestChosen, setGuestChosen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(GUEST_CHOSEN_KEY) === '1';
    } catch {
      return false;
    }
  });

  const showGate = !loading && !user && !guestChosen;

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

  const enterGuest = useCallback(() => {
    setGuestChosen(true);
    try {
      window.localStorage.setItem(GUEST_CHOSEN_KEY, '1');
    } catch {
      /* 忽略隐私模式等写入失败 */
    }
    setAuthModalOpen(false);
    setModalVariant('action');
    setForceAuthReason(null);
  }, []);

  const openAuthModal = useCallback((after?: () => Promise<void> | void) => {
    setPendingAction(after ? () => after : null);
    setModalVariant('action');
    setForceAuthReason(null);
    setAuthModalOpen(true);
  }, []);

  // action 变体可直接关;gate 变体关闭=进入访客;forced 变体不可关。
  const closeAuthModal = useCallback(() => {
    if (modalVariant === 'forced') return;
    if (modalVariant === 'gate') {
      enterGuest();
      return;
    }
    setAuthModalOpen(false);
    setPendingAction(null);
  }, [modalVariant, enterGuest]);

  const consumePending = useCallback(() => {
    setAuthModalOpen(false);
    setModalVariant('action');
    setForceAuthReason(null);
    const action = pendingAction;
    setPendingAction(null);
    if (action) action();
  }, [pendingAction]);

  const forceAuth = useCallback((reason: 'guest_limit' = 'guest_limit') => {
    setForceAuthReason(reason);
    setModalVariant('forced');
    setAuthModalOpen(true);
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    authModalOpen,
    modalVariant,
    forceAuthReason,
    showGate,
    pendingAction,
    refresh,
    login,
    register,
    logout,
    openAuthModal,
    closeAuthModal,
    consumePending,
    enterGuest,
    forceAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
