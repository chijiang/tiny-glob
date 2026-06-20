'use client';

type Props = {
  error?: string | null;
  busy?: boolean;
  progressText?: string;
};

export default function StatusOverlay({ error, busy, progressText }: Props) {
  if (error) {
    return <div className="toast error">{error}</div>;
  }
  if (busy) {
    return <div className="toast busy">{progressText || '正在查阅资料并准备对话…'}</div>;
  }
  return null;
}
