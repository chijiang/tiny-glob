'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { MAX_GUEST_CONVERSATIONS, MAX_GUEST_ROUNDS } from '@/lib/guest-policy';

const FORCED_TEXT: Record<string, string> = {
  guest_limit: `访客可体验的 ${MAX_GUEST_CONVERSATIONS} 段对话已用完,注册后即可无限制地继续探索。`,
};

export default function AuthModal() {
  const {
    authModalOpen,
    modalVariant,
    forceAuthReason,
    showGate,
    login,
    register,
    closeAuthModal,
    consumePending,
    enterGuest,
  } = useAuth();

  const open = authModalOpen || showGate;
  // authModalOpen 优先(action/forced);否则回落到访客门 gate。
  const variant = authModalOpen ? modalVariant : 'gate';

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const isGate = variant === 'gate';
  const isForced = variant === 'forced';
  const canClose = !isForced; // forced 不可关闭

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password);
      setEmail('');
      setPassword('');
      consumePending(); // 关弹窗 + 若有挂起的动作(如收藏)则执行
    } catch (err: any) {
      setError(err?.message ?? '出错了');
    } finally {
      setBusy(false);
    }
  };

  const onBackdrop = () => {
    if (!canClose) return;
    closeAuthModal(); // gate 关闭=进入访客;action 关闭=直接关
  };

  return (
    <div className="modal-backdrop" onClick={onBackdrop}>
      <div className="modal auth-modal" onClick={(e) => e.stopPropagation()}>
        {isGate && (
          <div className="auth-banner auth-banner-gate">
            <div className="auth-banner-title">欢迎来到 TinyGlob</div>
            <div className="auth-banner-sub">
              登录可保存进度、无限制对话;也可先以访客身份体验
              <br />
              (访客限 {MAX_GUEST_CONVERSATIONS} 段对话,每段 {MAX_GUEST_ROUNDS} 轮)。
            </div>
          </div>
        )}
        {isForced && (
          <div className="auth-banner auth-banner-forced">
            {(forceAuthReason && FORCED_TEXT[forceAuthReason]) || '注册或登录后即可继续。'}
          </div>
        )}

        <div className="modal-tabs">
          <button
            className={mode === 'login' ? 'active' : ''}
            onClick={() => { setMode('login'); setError(null); }}
          >
            登录
          </button>
          <button
            className={mode === 'register' ? 'active' : ''}
            onClick={() => { setMode('register'); setError(null); }}
          >
            注册
          </button>
          {canClose && <button className="modal-close" onClick={closeAuthModal} title="关闭">×</button>}
        </div>
        <form onSubmit={submit} className="auth-form">
          <input
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            type="password"
            placeholder="密码(至少 6 位)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={6}
          />
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="auth-submit" disabled={busy || !email || password.length < 6}>
            {busy ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>

        {isGate && (
          <button className="auth-guest-btn" onClick={enterGuest} disabled={busy}>
            以访客身份继续
          </button>
        )}
      </div>
    </div>
  );
}
