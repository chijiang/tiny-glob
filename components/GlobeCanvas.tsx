'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';

type Coords = { lat: number; lng: number };

type FlyTarget = Coords & { nonce: number };

type Props = {
  onPick: (coords: Coords) => void;
  marker?: Coords | null;
  /** 设置后地球会平滑飞到该坐标;nonce 变化触发重新飞行 */
  flyTo?: FlyTarget | null;
};

// 用 jsdelivr 的纹理(plan 验证过 unpkg 有问题)
const GLOBE_IMAGE = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg';
const BUMP_IMAGE = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png';

type CityLabel = {
  lat: number;
  lng: number;
  label: string;
  /** 1=最重要(顶级 50) ... 5=最不重要(town,前 4000 末段) */
  importance: 1 | 2 | 3 | 4 | 5;
};

// POV altitude 阈值(单位:地球半径倍数)。值越小越靠近地表。
// 缩放越深,显示越多城市(逐级展开)。
//   alt > 2.2  → 全景,不显示标签
//   alt ≤ 2.2  → T1 (顶级 50 个:东京/纽约/上海/伦敦/伊斯坦布尔…)
//   alt ≤ 1.5  → +T2 (前 250:区域首都/大都会)
//   alt ≤ 0.9  → +T3 (前 800:中等城市)
//   alt ≤ 0.5  → +T4 (前 2000:小城市)
//   alt ≤ 0.25 → +T5 (前 4000:城镇级,基本能找到大多数家乡)
const T1_ALT = 2.2;
const T2_ALT = 1.5;
const T3_ALT = 0.9;
const T4_ALT = 0.5;
const T5_ALT = 0.25;

// three-globe 默认地球半径
const GLOBE_RADIUS = 100;

// 与 three-globe 一致的极坐标→笛卡尔坐标转换
function polar2cartesian(lat: number, lng: number, r: number) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((90 - lng) * Math.PI) / 180;
  return {
    x: r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.cos(phi),
    z: r * Math.sin(phi) * Math.sin(theta),
  };
}

type Tier = 0 | 1 | 2 | 3 | 4 | 5;
function altitudeToMaxImportance(alt: number): Tier {
  if (alt > T1_ALT) return 0;
  if (alt > T2_ALT) return 1;
  if (alt > T3_ALT) return 2;
  if (alt > T4_ALT) return 3;
  if (alt > T5_ALT) return 4;
  return 5;
}

// 城市 label 在数据集中可能重名(Alexandria 在埃及/美国都有),用 lat,lng 区分
function labelKey(c: { lat: number; lng: number; label: string }) {
  return `${c.label}@${c.lat.toFixed(2)},${c.lng.toFixed(2)}`;
}

export default function GlobeCanvas({ onPick, marker, flyTo }: Props) {
  const [size, setSize] = useState({ width: 800, height: 800 });
  const [cities, setCities] = useState<CityLabel[]>([]);
  const [maxImportance, setMaxImportance] = useState<Tier>(0);
  const globeRef = useRef<any>(null);
  const labelRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const cityIndexRef = useRef<Map<string, CityLabel>>(new Map());
  const tmpVec = useRef(new THREE.Vector3());

  useEffect(() => {
    function onResize() {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    }
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 懒加载城市数据(放在 /public 不进 JS bundle)
  useEffect(() => {
    let cancelled = false;
    fetch('/cities.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CityLabel[] | null) => {
        if (!cancelled && data) setCities(data);
      })
      .catch(() => {
        /* 城市标签是增强体验,加载失败不影响主功能 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!flyTo || !globeRef.current) return;
    try {
      // 1.5 让用户飞到目标后能看到 T1+T2 标签(250 个),有足够上下文
      globeRef.current.pointOfView({ lat: flyTo.lat, lng: flyTo.lng, altitude: 1.5 }, 1200);
    } catch {
      /* pointOfView 在 Globe 挂载前可能未就绪,忽略 */
    }
  }, [flyTo]);

  // 主循环:两段式,避免每帧遍历全部城市(4000 个 at tier 5)。
  //   重算可见集(5Hz,节流):tier+near-side+视口内候选 → 按"距屏幕中心距离"排序(importance 仅做相近时平局) → 取 top MAX_VISIBLE
  //   位置更新(60fps):仅对当前可见集做投影 + transform 写 DOM
  useEffect(() => {
    let raf = 0;
    let lastTier: number = -1;
    let lastRecompute = 0;
    let currentVisible = new Set<string>();
    let prevVisible = new Set<string>();

    // 同屏最多显示多少标签。再多了文字必然重叠看不清。
    const MAX_VISIBLE = 70;
    const RECOMPUTE_MS = 200; // 5Hz,够用且省 CPU

    // 加权评分:大城(importance 小)有更高基础分,在任何位置都比小城更易入选;
    // 距中心越远分数越衰减。这样中心区域所有层级都显示,边角只剩 T1/T2 骨架。
    //   score = TIER_MULT[importance-1] / (1 + 屏幕距离 / DIST_SCALE)
    const TIER_MULT: readonly number[] = [8, 4, 2, 1, 0.5]; // T1..T5
    const DIST_SCALE_PX = 300;

    const recompute = (
      pov: { lat: number; lng: number; altitude: number },
      camera: THREE.Camera,
    ) => {
      const idx = cityIndexRef.current;
      if (idx.size === 0) return;
      const w = size.width;
      const h = size.height;
      const cx = w / 2;
      const cy = h / 2;
      const pv = polar2cartesian(pov.lat, pov.lng, 1);
      // 相机在有限距离(altitude)处,地球曲率会遮挡 POV 中心 acos(1/(1+alt)) 以外的点。
      // 之前只判 dot>0(相当于相机在无穷远)会把曲率背后、但仍投影进剪影圆的点算进来,
      // 表现为放大后地球边角出现"背面城市"。这里按当前 altitude 收紧可见性阈值。
      const dotThreshold = 1 / (1 + pov.altitude);

      // 收集"视口内 + 近半球"候选,同时记录距屏幕中心平方距离
      const inView: { key: string; importance: number; sd: number }[] = [];
      idx.forEach((city, key) => {
        const v = polar2cartesian(city.lat, city.lng, 1);
        const dot = pv.x * v.x + pv.y * v.y + pv.z * v.z;
        if (dot < dotThreshold) return; // 曲率遮挡/远半球
        const p = polar2cartesian(city.lat, city.lng, GLOBE_RADIUS);
        tmpVec.current.set(p.x, p.y, p.z);
        tmpVec.current.project(camera);
        const sx = ((tmpVec.current.x + 1) / 2) * w;
        const sy = ((1 - tmpVec.current.y) / 2) * h;
        if (sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50) return;
        const dx = sx - cx;
        const dy = sy - cy;
        inView.push({ key, importance: city.importance, sd: dx * dx + dy * dy });
      });

      // 评分降序:大城 + 靠中心 = 高分
      const scored = inView.map((c) => ({
        key: c.key,
        score: TIER_MULT[c.importance - 1] / (1 + Math.sqrt(c.sd) / DIST_SCALE_PX),
      }));
      scored.sort((a, b) => b.score - a.score);

      prevVisible = currentVisible;
      currentVisible = new Set();
      for (let i = 0; i < scored.length && i < MAX_VISIBLE; i++) {
        currentVisible.add(scored[i].key);
      }

      // 把退出可见集的标签立刻藏起来(差分 hide,避免每帧检查全部)
      prevVisible.forEach((key) => {
        if (!currentVisible.has(key)) {
          const el = labelRefs.current.get(key);
          if (el && el.style.opacity !== '0') el.style.opacity = '0';
        }
      });
    };

    const tick = (t: number) => {
      const g = globeRef.current;
      const pov = g?.pointOfView?.();
      const camera = g?.camera?.();
      if (pov && camera && typeof pov.altitude === 'number') {
        const tier = altitudeToMaxImportance(pov.altitude);
        const tierChanged = tier !== lastTier;
        if (tierChanged) {
          lastTier = tier;
          setMaxImportance(tier);
        }

        // 5Hz 或 tier 刚变 → 重算可见集(几百~几千候选,~5ms)
        if (tierChanged || t - lastRecompute > RECOMPUTE_MS) {
          lastRecompute = t;
          recompute(pov, camera);
        }

        // 每帧:仅对当前可见集(≤MAX_VISIBLE)做投影 + DOM 写
        if (currentVisible.size > 0) {
          const w = size.width;
          const h = size.height;
          const idx = cityIndexRef.current;
          const pv = polar2cartesian(pov.lat, pov.lng, 1);
          const dotThreshold = 1 / (1 + pov.altitude);
          currentVisible.forEach((key) => {
            const city = idx.get(key);
            const el = labelRefs.current.get(key);
            if (!city || !el) return;
            // POV 在两次 recompute 之间可能已转走,这里再用曲率阈值卡一次,
            // 防止刚刚还算"可见"的标签在转地球时滑到背面仍显示。
            const uv = polar2cartesian(city.lat, city.lng, 1);
            const dot = pv.x * uv.x + pv.y * uv.y + pv.z * uv.z;
            if (dot < dotThreshold) {
              if (el.style.opacity !== '0') el.style.opacity = '0';
              return;
            }
            const p = polar2cartesian(city.lat, city.lng, GLOBE_RADIUS);
            tmpVec.current.set(p.x, p.y, p.z);
            tmpVec.current.project(camera);
            const sx = ((tmpVec.current.x + 1) / 2) * w;
            const sy = ((1 - tmpVec.current.y) / 2) * h;
            // 快速 pan 时可能短暂飞出视口,仍需检查
            if (sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50) {
              if (el.style.opacity !== '0') el.style.opacity = '0';
              return;
            }
            if (el.style.opacity !== '0.9') el.style.opacity = '0.9';
            el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
          });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size.width, size.height]);

  const points = marker ? [{ lat: marker.lat, lng: marker.lng, color: '#ff5e3a' }] : [];

  const visibleLabels = useMemo(() => {
    if (maxImportance === 0) return [];
    const list = cities.filter((c) => c.importance <= maxImportance);
    // 同步重建索引供 rAF 循环查找
    const idx = new Map<string, CityLabel>();
    for (const c of list) idx.set(labelKey(c), c);
    cityIndexRef.current = idx;
    return list;
  }, [cities, maxImportance]);

  return (
    <>
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        backgroundColor="#000010"
        globeImageUrl={GLOBE_IMAGE}
        bumpImageUrl={BUMP_IMAGE}
        pointsData={points}
        pointLat="lat"
        pointLng="lng"
        pointAltitude={0.01}
        pointRadius={0.35}
        pointColor={(d: any) => (d as any).color}
        pointResolution={6}
        onGlobeClick={({ lat, lng }: { lat: number; lng: number }) => onPick({ lat, lng })}
      />
      <div className="globe-label-overlay" aria-hidden>
        {visibleLabels.map((c) => {
          const key = labelKey(c);
          return (
            <div
              key={key}
              ref={(el) => {
                if (el) labelRefs.current.set(key, el);
                else labelRefs.current.delete(key);
              }}
              className={`globe-city-label tier-${c.importance}`}
            >
              <span className="globe-city-dot" />
              <span className="globe-city-text">{c.label}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
