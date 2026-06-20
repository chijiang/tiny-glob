'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';

export default function AuthModal() {
  const { authModalOpen, login, register, closeAuthModal, consumePending } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!authModalOpen) return null;

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

  return (
    <div className="modal-backdrop" onClick={closeAuthModal}>
      <div className="modal auth-modal" onClick={(e) => e.stopPropagation()}>
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
          <button className="modal-close" onClick={closeAuthModal} title="关闭">×</button>
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
      </div>
    </div>
  );
}
