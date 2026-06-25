'use client';

import { useCallback, useEffect, useState } from 'react';

type Arch = {
  id: string;
  key: string;
  label: string;
  flavor: string;
  directive: string;
  stateOverride: Record<string, number> | null;
  weight: number;
  enabled: boolean;
};
type Config = { probability: string; archetypes: Arch[] };

export default function AdminConsole() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [data, setData] = useState<Config | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/console-7f3c2/config');
    if (res.status === 401) {
      setAuthed(false);
      return;
    }
    if (!res.ok) return;
    setData(await res.json());
    setAuthed(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (authed === null) return <div className="admin-page"><p>加载中…</p></div>;
  if (!authed) return <Login onSuccess={load} />;

  return <Dashboard data={data} reload={load} onLogout={async () => {
    await fetch('/api/console-7f3c2/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
    setAuthed(false);
    setData(null);
  }} />;
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/console-7f3c2/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'login', username: username.trim(), password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? '登录失败');
        return;
      }
      onSuccess();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-page">
      <form className="admin-card admin-login" onSubmit={submit}>
        <h1>后台登录</h1>
        <input placeholder="账号" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
        <input type="password" placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="admin-error">{error}</div>}
        <button type="submit" className="primary" disabled={busy || !username || !password}>{busy ? '校验中…' : '登录'}</button>
      </form>
    </div>
  );
}

function Dashboard({ data, reload, onLogout }: { data: Config | null; reload: () => void; onLogout: () => void }) {
  return (
    <div className="admin-page">
      <header className="admin-header">
        <h1>TinyGlob 后台</h1>
        <button onClick={onLogout}>退出</button>
      </header>

      <ProbabilityCard probability={data?.probability ?? '0.04'} reload={reload} />
      <ArchetypesCard archetypes={data?.archetypes ?? []} reload={reload} />
      <PasswordCard />
    </div>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const mismatch = next !== confirm;
  const tooShort = next.length > 0 && next.length < 8;
  const canSubmit = !!current && !!next && !mismatch && !tooShort;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch('/api/console-7f3c2/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'changeAdminPassword', current, next }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d?.error ?? '修改失败');
        return;
      }
      setMsg('密码已更新');
      setCurrent('');
      setNext('');
      setConfirm('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-card">
      <h2>修改管理员密码</h2>
      <p className="admin-hint">新密码至少 8 位。修改后当前会话仍有效,下次登录用新密码。</p>
      <form className="admin-login" onSubmit={submit} style={{ maxWidth: 420 }}>
        <input type="password" placeholder="当前密码" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        <input type="password" placeholder="新密码(至少 8 位)" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <input type="password" placeholder="再次输入新密码" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        {tooShort && <div className="admin-error">新密码至少 8 位</div>}
        {mismatch && next && confirm && <div className="admin-error">两次输入不一致</div>}
        {err && <div className="admin-error">{err}</div>}
        {msg && <div className="admin-msg">{msg}</div>}
        <button type="submit" className="primary" disabled={busy || !canSubmit}>{busy ? '…' : '更新密码'}</button>
      </form>
    </section>
  );
}

function ProbabilityCard({ probability, reload }: { probability: string; reload: () => void }) {
  const [val, setVal] = useState(probability);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setVal(probability), [probability]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/console-7f3c2/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'setSetting', key: 'npc.rareProbability', value: val }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(d?.error ?? '保存失败');
      else setMsg('已保存');
      reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-card">
      <h2>稀遇触发概率</h2>
      <p className="admin-hint">每次生成 NPC 时命中稀遇对象的概率(0–1)。如 0.04 = 约 4%,即约每 25 次出现一次。</p>
      <div className="admin-inline">
        <input type="number" step="0.01" min={0} max={1} value={val} onChange={(e) => setVal(e.target.value)} />
        <button className="primary" onClick={save} disabled={busy || val === probability}>{busy ? '…' : '保存'}</button>
      </div>
      {msg && <div className="admin-msg">{msg}</div>}
    </section>
  );
}

function ArchetypesCard({ archetypes, reload }: { archetypes: Arch[]; reload: () => void }) {
  return (
    <section className="admin-card">
      <h2>稀遇对象池 <span className="admin-count">({archetypes.length})</span></h2>
      <p className="admin-hint">增删/启用/调权重。stateOverride 是初始状态覆盖(JSON,如 {"{ trust: 2 }"})。改完即时生效,无需重启。</p>
      <div className="admin-arch-list">
        {archetypes.map((a) => (
          <ArchRow key={a.key} arch={a} reload={reload} />
        ))}
      </div>
      <NewArch onCreate={() => reload()} />
    </section>
  );
}

function ArchRow({ arch, reload }: { arch: Arch; reload: () => void }) {
  const [a, setA] = useState(arch);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setA(arch), [arch]);

  const patch = (p: Partial<Arch>) => setA((x) => ({ ...x, ...p }));

  const toggle = async () => {
    const next = !a.enabled;
    patch({ enabled: next });
    await fetch('/api/console-7f3c2/config', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'toggleArchetype', key: a.key, enabled: next }),
    });
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      let override: Record<string, number> | null = null;
      const raw = overrideText.trim();
      if (raw) {
        try {
          override = JSON.parse(raw);
        } catch {
          setMsg('stateOverride 不是合法 JSON');
          return;
        }
      }
      const res = await fetch('/api/console-7f3c2/config', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'upsertArchetype', key: a.key, label: a.label, flavor: a.flavor, directive: a.directive, stateOverride: override, weight: a.weight, enabled: a.enabled }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(d?.error ?? '保存失败');
      else setMsg('已保存');
      reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`删除「${a.label}」?`)) return;
    await fetch('/api/console-7f3c2/config', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'deleteArchetype', key: a.key }),
    });
    reload();
  };

  // stateOverride 以文本编辑
  const [overrideText, setOverrideText] = useState(() => (a.stateOverride ? JSON.stringify(a.stateOverride) : ''));
  useEffect(() => setOverrideText(a.stateOverride ? JSON.stringify(a.stateOverride) : ''), [a.stateOverride]);

  return (
    <div className={`admin-arch-row ${a.enabled ? '' : 'disabled'}`}>
      <div className="admin-arch-head">
        <label className="admin-toggle">
          <input type="checkbox" checked={a.enabled} onChange={toggle} /> 启用
        </label>
        <span className="admin-arch-label">{a.label || '(未命名)'}</span>
        <code className="admin-arch-key">{a.key}</code>
        <span className="admin-arch-spacer" />
        <input className="admin-weight" type="number" min={0} max={100} value={a.weight} onChange={(e) => patch({ weight: Number(e.target.value) || 0 })} title="权重" />
        <button onClick={() => setOpen((o) => !o)}>{open ? '收起' : '编辑'}</button>
        <button onClick={remove} className="admin-danger">删除</button>
      </div>
      {open && (
        <div className="admin-arch-body">
          <label>标签(展示名)</label>
          <input value={a.label} onChange={(e) => patch({ label: e.target.value })} />
          <label>flavor(给玩家看的 toast 文案)</label>
          <input value={a.flavor} onChange={(e) => patch({ flavor: e.target.value })} />
          <label>directive(注入提示词的隐藏设定)</label>
          <textarea rows={4} value={a.directive} onChange={(e) => patch({ directive: e.target.value })} />
          <label>stateOverride(初始状态覆盖 JSON,可空)</label>
          <textarea rows={2} value={overrideText} onChange={(e) => setOverrideText(e.target.value)} placeholder='{"trust":2,"calm":3}' />
          <div className="admin-arch-actions">
            <button className="primary" onClick={save} disabled={busy}>{busy ? '…' : '保存'}</button>
            {msg && <span className="admin-msg">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function NewArch({ onCreate }: { onCreate: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [directive, setDirective] = useState('');
  const [flavor, setFlavor] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/console-7f3c2/config', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'upsertArchetype', key: key.trim(), label: label.trim(), flavor: flavor.trim() || label.trim(), directive: directive.trim(), weight: 1, enabled: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d?.error ?? '创建失败'); return; }
      setKey(''); setLabel(''); setDirective(''); setFlavor(''); setOpen(false);
      onCreate();
    } finally {
      setBusy(false);
    }
  };

  if (!open) return <button className="admin-add" onClick={() => setOpen(true)}>+ 新增稀遇对象</button>;
  return (
    <div className="admin-arch-body admin-new">
      <label>key(英文唯一标识)</label>
      <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="如 hidden_wealth" />
      <label>标签</label>
      <input value={label} onChange={(e) => setLabel(e.target.value)} />
      <label>flavor(toast 文案,可留空则用标签)</label>
      <input value={flavor} onChange={(e) => setFlavor(e.target.value)} />
      <label>directive(隐藏设定)</label>
      <textarea rows={4} value={directive} onChange={(e) => setDirective(e.target.value)} />
      <div className="admin-arch-actions">
        <button className="primary" onClick={create} disabled={busy || !key || !label || !directive}>{busy ? '…' : '创建'}</button>
        <button onClick={() => setOpen(false)}>取消</button>
        {msg && <span className="admin-error">{msg}</span>}
      </div>
    </div>
  );
}
