'use client';

import dynamic from 'next/dynamic';

// react-globe.gl 依赖浏览器 API(three/window),必须关闭 SSR。
// 用 dynamic 拆出独立模块,加载前显示占位。
const GlobeCanvas = dynamic(() => import('./GlobeCanvas'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#8aa',
        fontSize: 14,
        background: '#000010',
      }}
    >
      正在加载地球…
    </div>
  ),
});

type Coords = { lat: number; lng: number };
type FlyTarget = Coords & { nonce: number };

type Props = {
  onPick: (coords: Coords) => void;
  marker?: Coords | null;
  /** 设置后地球平滑飞到该坐标;nonce 变化触发重新飞行 */
  flyTo?: FlyTarget | null;
};

export default function GlobeView(props: Props) {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <GlobeCanvas {...props} />
    </div>
  );
}
