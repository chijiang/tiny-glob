'use client';

import { useState } from 'react';

type Props = {
  initialYear?: number;
  initialMonth?: number;
  onConfirm: (year: number, month: number) => void;
  onCancel: () => void;
};

export default function TimePicker({
  initialYear = 1945,
  initialMonth = 1,
  onConfirm,
  onCancel,
}: Props) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);

  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = currentYear; y >= 1500; y -= 1) years.push(y);

  return (
    <div className="overlay-card">
      <h3>选择一个时间</h3>
      <p className="hint">我们将查阅这个地点、这段时间里真实发生过的事。</p>
      <div className="row">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y} 年
            </option>
          ))}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m} 月
            </option>
          ))}
        </select>
      </div>
      <div className="row right">
        <button onClick={onCancel}>取消</button>
        <button className="primary" onClick={() => onConfirm(year, month)}>
          开始查阅
        </button>
      </div>
    </div>
  );
}
