import { Coords, PlaceInfo } from './types';

// 注:OpenStreetMap Nominatim 在部分网络环境(代理/数据中心 IP/特定地区)会返回
// 403 Access denied。改用 BigDataCloud 的 reverse-geocode-client 免费端点
// (无 key、政策宽松,专为无密钥场景设计)。文件名保留历史命名。
const BDC_BASE = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

// 内存缓存,精度到 0.001° (~100m),TTL 1h
const cache = new Map<string, { value: PlaceInfo | null; expires: number }>();
const TTL = 60 * 60 * 1000;

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export async function reverseGeocode({ lat, lng }: Coords): Promise<PlaceInfo | null> {
  const key = `${round(lat)},${round(lng)}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value: PlaceInfo | null = null;
  try {
    const url = `${BDC_BASE}?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
    const res = await fetch(url);
    if (res.ok) {
      const d = await res.json();
      if (d && !d.error) {
        const name =
          d.city || d.locality || d.principalSubdivision || d.countryName || '未知地点';
        const parts = [d.city, d.principalSubdivision, d.countryName].filter(Boolean);
        value = {
          name,
          displayName: parts.join(', ') || String(name),
          country: d.countryName ?? '',
          countryCode: typeof d.countryCode === 'string' ? d.countryCode : undefined,
        };
      }
    }
  } catch {
    value = null;
  }

  // 只缓存成功结果,避免瞬时失败污染缓存 1h
  if (value) cache.set(key, { value, expires: Date.now() + TTL });
  return value;
}
