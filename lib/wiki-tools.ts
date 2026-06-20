import OpenAI from 'openai';
import { reverseGeocode } from './nominatim';
import { WikiEvent } from './types';

const API_BASE = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'TinyGlob/0.1 (contact@example.com)';

// 内存缓存(TTL 1h),避免 agent 重复查同一处
const cache = new Map<string, { value: unknown; expires: number }>();
const TTL = 60 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  return null;
}
function setCached(key: string, value: unknown): void {
  if (cache.size > 500) cache.clear();
  cache.set(key, { value, expires: Date.now() + TTL });
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

async function wikiQuery(params: URLSearchParams): Promise<any> {
  const res = await fetch(`${API_BASE}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
  return res.json();
}

// ===== 工具实现 =====

export type GeoInfo = {
  name: string;
  country: string;
  countryCode?: string;
  region?: string;
};

export async function geocodeInfo(lat: number, lng: number): Promise<GeoInfo | null> {
  const place = await reverseGeocode({ lat, lng });
  if (!place) return null;
  // 从 displayName 推断 region(省份),格式形如 "City, Region, Country"
  const parts = place.displayName.split(',').map((s) => s.trim());
  return {
    name: place.name,
    country: place.country,
    countryCode: place.countryCode,
    region: parts.length >= 3 ? parts[parts.length - 2] : undefined,
  };
}

export type GeoResult = {
  pageid: number;
  title: string;
  extract: string;
  categories: string[];
  url: string;
};

export async function wikiGeosearch(lat: number, lng: number, radiusM = 10000): Promise<GeoResult[]> {
  const radius = Math.max(10, Math.min(10000, radiusM)); // MediaWiki 硬限 10km
  const key = `geo:${lat.toFixed(3)},${lng.toFixed(3)},${radius}`;
  const cached = getCached<GeoResult[]>(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    action: 'query',
    generator: 'geosearch',
    ggscoord: `${lat}|${lng}`,
    ggsradius: String(radius),
    ggslimit: '20',
    prop: 'extracts|categories',
    exintro: '1',
    explaintext: '1',
    cllimit: '10',
    format: 'json',
    redirects: '1',
  });
  const data = await wikiQuery(params);
  const pages = data?.query?.pages;
  if (!pages) return [];

  const results: GeoResult[] = Object.values<any>(pages).map((p) => ({
    pageid: p.pageid,
    title: p.title,
    extract: truncate(p.extract || '', 200),
    categories: (p.categories || []).map((c: any) => c.title as string),
    url: `https://en.wikipedia.org/?curid=${p.pageid}`,
  }));
  setCached(key, results);
  return results;
}

export type SearchResult = {
  pageid: number;
  title: string;
  snippet: string;
  wordcount?: number;
  url: string;
};

export async function wikiSearch(
  query: string,
): Promise<{ results: SearchResult[]; totalhits: number }> {
  const key = `search:${query}`;
  const cached = getCached<{ results: SearchResult[]; totalhits: number }>(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '8',
    srnamespace: '0',
    srprop: 'snippet|wordcount',
    format: 'json',
    redirects: '1',
  });
  const data = await wikiQuery(params);
  const items: any[] = data?.query?.search ?? [];
  const results: SearchResult[] = items.map((s) => ({
    pageid: s.pageid,
    title: s.title,
    snippet: truncate(stripHtml(s.snippet || ''), 200),
    wordcount: s.wordcount,
    url: `https://en.wikipedia.org/?curid=${s.pageid}`,
  }));
  const out = { results, totalhits: data?.query?.searchinfo?.totalhits ?? results.length };
  setCached(key, out);
  return out;
}

export type PageResult = {
  pageid: number;
  title: string;
  extract: string;
  categories: string[];
  url: string;
};

export async function wikiGetPage(opts: {
  title?: string;
  pageid?: number;
}): Promise<PageResult | null> {
  if (!opts.title && !opts.pageid) return null;
  const idKey = opts.pageid ? `pid:${opts.pageid}` : `title:${opts.title}`;
  const cached = getCached<PageResult>(idKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts|categories',
    explaintext: '1',
    cllimit: '20',
    format: 'json',
    redirects: '1',
  });
  if (opts.pageid) params.set('pageids', String(opts.pageid));
  else if (opts.title) params.set('titles', opts.title);
  const data = await wikiQuery(params);
  const pages = data?.query?.pages;
  if (!pages) return null;
  const page = Object.values<any>(pages)[0];
  if (!page) return null;

  const result: PageResult = {
    pageid: page.pageid,
    title: page.title,
    extract: truncate(page.extract || '', 1500), // 全文截断(去掉 exintro 限制)
    categories: (page.categories || []).map((c: any) => c.title as string),
    url: `https://en.wikipedia.org/?curid=${page.pageid}`,
  };
  setCached(idKey, result);
  return result;
}

// ===== 工具 schema(OpenAI function calling 格式) =====

export function buildToolSchemas(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'geocode_info',
        description:
          'Get the place name, country, and region for given coordinates. Call this first to confirm where you are.',
        parameters: {
          type: 'object',
          properties: {
            lat: { type: 'number', description: 'Latitude' },
            lng: { type: 'number', description: 'Longitude' },
          },
          required: ['lat', 'lng'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'wiki_geosearch',
        description:
          'Find Wikipedia articles physically near coordinates (local events, landmarks). Radius capped at 10000m.',
        parameters: {
          type: 'object',
          properties: {
            lat: { type: 'number' },
            lng: { type: 'number' },
            radius_m: {
              type: 'number',
              description: 'Search radius in meters, 10-10000. Default 10000.',
            },
          },
          required: ['lat', 'lng'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'wiki_search',
        description:
          'Full-text search across all English Wikipedia articles. Use this to find national-level events, events from any time period, or topics too far from the coordinates for geosearch. Examples: "China 1949", "Wuxi history", "Chinese Civil War".',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search terms. Can combine place names, years, event names.',
            },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'wiki_get_page',
        description:
          'Read the full text of one Wikipedia article by title or pageid, to verify relevance or get details.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Article title' },
            pageid: { type: 'number', description: 'Article pageid' },
          },
        },
      },
    },
  ];
}

// ===== 分发器:执行工具,累积事件进 collected(去重 by pageid) =====

export type DispatchResult = {
  data: unknown; // 回填给 LLM 的 JSON
  progress: string; // 进度文案
};

export async function dispatchTool(
  name: string,
  args: Record<string, any>,
  country: string,
  collected: WikiEvent[],
  seenIds: Set<number>,
): Promise<DispatchResult> {
  switch (name) {
    case 'geocode_info': {
      const r = await geocodeInfo(Number(args.lat), Number(args.lng));
      return { data: r ?? { error: 'no place found' }, progress: '正在确认地点…' };
    }
    case 'wiki_geosearch': {
      const radius = typeof args.radius_m === 'number' ? args.radius_m : 10000;
      const r = await wikiGeosearch(Number(args.lat), Number(args.lng), radius).catch(() => [] as GeoResult[]);
      mergeEvents(collected, seenIds, r);
      return { data: { count: r.length, results: r.slice(0, 15) }, progress: '正在搜索当地资料…' };
    }
    case 'wiki_search': {
      const r = await wikiSearch(String(args.query ?? '')).catch(() => ({
        results: [] as SearchResult[],
        totalhits: 0,
      }));
      mergeEvents(
        collected,
        seenIds,
        r.results.map((x) => ({
          pageid: x.pageid,
          title: x.title,
          extract: x.snippet,
          categories: [],
          url: x.url,
        })),
      );
      const isNational =
        !!country && !!args.query && String(args.query).toLowerCase().includes(country.toLowerCase());
      return {
        data: { totalhits: r.totalhits, results: r.results },
        progress: isNational ? '正在搜索全国层面资料…' : '正在检索相关历史…',
      };
    }
    case 'wiki_get_page': {
      const r = await wikiGetPage({
        title: args.title ? String(args.title) : undefined,
        pageid: typeof args.pageid === 'number' ? args.pageid : undefined,
      }).catch(() => null);
      if (r) {
        mergeEvents(collected, seenIds, [
          { pageid: r.pageid, title: r.title, extract: r.extract, categories: r.categories, url: r.url },
        ]);
      }
      return { data: r ?? { error: 'page not found' }, progress: '正在深入阅读条目…' };
    }
    default:
      return { data: { error: `unknown tool ${name}` }, progress: '' };
  }
}

function mergeEvents(collected: WikiEvent[], seenIds: Set<number>, incoming: WikiEvent[]): void {
  for (const e of incoming) {
    if (e.pageid && !seenIds.has(e.pageid)) {
      seenIds.add(e.pageid);
      collected.push(e);
    }
  }
}
