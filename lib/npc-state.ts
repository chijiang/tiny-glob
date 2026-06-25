import { NpcState } from './types';

// ===== NPC 状态:8 个维度(1-10)+ 一句内心看法 perception =====
// 服务端(提示词注入/校验)与客户端(UI/披露)共用本模块。

export const NPC_STATE_KEYS = [
  'affinity',
  'trust',
  'respect',
  'joy',
  'calm',
  'vulnerability',
  'gratitude',
  'curiosity',
] as const;
export type NpcStateKey = (typeof NPC_STATE_KEYS)[number];

type DisclosureTier = 'always' | 'unlock' | 'event';

export type DimensionMeta = {
  key: NpcStateKey;
  label: string; // 中文展示名
  low: string; // 1 的极值含义
  high: string; // 10 的极值含义
  bipolar?: boolean; // 双极(中性≈5,如 感激/愤怒)
  tier: DisclosureTier; // 披露策略
};

/**
 * 维度元数据。tier 决定何时给玩家看:
 * - always:始终显示(好感条、心情)
 * - unlock:好感达阈值才解锁(信任、尊敬——关系深了才读得到)
 * - event :仅在剧烈变化时以 toast/心声提示(松弛、袒露、感激、好奇)
 */
export const DIMENSIONS: DimensionMeta[] = [
  { key: 'affinity', label: '好感', low: '厌烦', high: '亲密', tier: 'always' },
  { key: 'joy', label: '情绪', low: '悲伤', high: '喜悦', tier: 'always' },
  { key: 'trust', label: '信任', low: '戒备', high: '深信', tier: 'unlock' },
  { key: 'respect', label: '尊敬', low: '轻视', high: '敬重', tier: 'unlock' },
  { key: 'calm', label: '松弛', low: '紧张', high: '放松', tier: 'event' },
  { key: 'vulnerability', label: '袒露', low: '防备', high: '袒露', tier: 'event' },
  { key: 'gratitude', label: '感激', low: '愤怒', high: '感恩', bipolar: true, tier: 'event' },
  { key: 'curiosity', label: '好奇', low: '冷淡', high: '好奇', tier: 'event' },
];

/** 好感达此值才向玩家解锁 trust/respect 的展示。 */
export const UNLOCK_AFFINITY = 7;

/** 单轮状态变化的最大幅度,防止情绪乱跳。 */
export const MAX_DELTA_PER_TURN = 3;

export function defaultNpcState(): NpcState {
  return {
    affinity: 5,
    trust: 3,
    respect: 5,
    joy: 5,
    calm: 5,
    vulnerability: 4,
    gratitude: 5,
    curiosity: 5,
    perception: '',
  };
}

function clampDim(n: unknown): number {
  const x = Math.round(Number(n));
  return Number.isFinite(x) ? Math.max(1, Math.min(10, x)) : 5;
}

/**
 * 把 LLM 吐出的状态(可能缺字段/越界)净化为合法 NpcState。
 * 以 base 为底(通常是上一轮状态),用 raw 覆盖;并按 MAX_DELTA_PER_TURN 限幅单轮变化。
 */
export function sanitizeState(raw: any, base: NpcState): NpcState {
  const out: NpcState = { ...base };
  for (const k of NPC_STATE_KEYS) {
    if (raw && raw[k] != null) {
      const prev = base[k];
      let next = clampDim(raw[k]);
      // 限幅:单轮每个维度最多变化 MAX_DELTA_PER_TURN。
      if (next > prev + MAX_DELTA_PER_TURN) next = prev + MAX_DELTA_PER_TURN;
      if (next < prev - MAX_DELTA_PER_TURN) next = prev - MAX_DELTA_PER_TURN;
      (out as Record<NpcStateKey, number>)[k] = clampDim(next);
    }
  }
  out.perception =
    raw && typeof raw.perception === 'string' ? raw.perception.slice(0, 60) : base.perception;
  return out;
}

/** 用稀遇原型的 stateOverride(部分维度)叠加到基线状态。 */
export function applyOverride(base: NpcState, override?: Record<string, number> | null): NpcState {
  if (!override) return base;
  const out: NpcState = { ...base };
  for (const k of NPC_STATE_KEYS) {
    if (override[k] != null) (out as Record<NpcStateKey, number>)[k] = clampDim(override[k]);
  }
  return out;
}

/**
 * 由状态派生一个"心情"展示(给玩家始终可见的情绪信号)。
 * 综合考虑 joy(情绪)、calm(松弛)、gratitude(愤怒端)。
 */
export function deriveMood(s: NpcState): { emoji: string; label: string } {
  if (s.gratitude <= 2) return { emoji: '😠', label: '愠怒' };
  if (s.calm <= 2) return { emoji: '😣', label: '紧张' };
  if (s.joy >= 8) return { emoji: '😊', label: '喜悦' };
  if (s.joy >= 6) return { emoji: '🙂', label: '愉快' };
  if (s.joy <= 2) return { emoji: '😢', label: '悲伤' };
  if (s.joy <= 4) return { emoji: '😟', label: '低落' };
  return { emoji: '😐', label: '平静' };
}
