import { prisma } from './prisma';

// ===== NPC 生成种子:服务端掷骰决定人口属性,作为【硬约束】注入提示词 =====
// 这样多元化和稀遇是确定性的(不依赖 LLM 自觉),彻底打破"默认中年男性"倾向。

export type RareArchetype = {
  key: string;
  label: string;
  flavor: string;
  directive: string;
  stateOverride: Record<string, number> | null;
};

export type NpcSeed = {
  gender: string; // 直接塞进提示词的性别要求
  ageBand: string; // 年龄段描述
  ageMin: number;
  ageMax: number;
  family: string; // 家庭境况
  traits: string[]; // 性格种子 2-3 个
  rare: RareArchetype | null; // 命中稀遇则非空
};

function weightedPick<T>(items: { item: T; weight: number }[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.weight;
    if (r < 0) return it.item;
  }
  return items[items.length - 1].item;
}

function pickDistinct<T>(pool: T[], n: number): T[] {
  const copy = [...pool];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

const GENDERS: { item: string; weight: number }[] = [
  { item: '女', weight: 47 },
  { item: '男', weight: 47 },
  { item: '罕见设定:女扮男装、异装、或在当时难以简单归类为男女的身份', weight: 6 },
];

const AGE_BANDS: { item: { band: string; min: number; max: number }; weight: number }[] = [
  { item: { band: '少年(约14-17岁)', min: 14, max: 17 }, weight: 15 },
  { item: { band: '青年(约18-29岁)', min: 18, max: 29 }, weight: 30 },
  { item: { band: '中年(约30-49岁)', min: 30, max: 49 }, weight: 35 },
  { item: { band: '长者(约50-70岁)', min: 50, max: 70 }, weight: 20 },
];

const FAMILIES = [
  '已婚,与配偶和子女同住',
  '鳏寡独居',
  '尚未婚配,与父母同住',
  '已婚无子',
  '多代同堂的大家庭',
  '寄人篱下,在亲戚或雇主家帮佣',
  '丧偶,独自拉扯幼子',
  '与兄弟姐妹同住',
  '孑然一身,无亲无故',
  '再婚的重组家庭',
];

const TRAITS = [
  '急躁', '温吞慢热', '健谈', '沉默寡言', '多疑', '天真易信', '世故圆滑', '冷面幽默',
  '多愁善感', '乐天派', '固执己见', '八面玲珑', '胆大鲁莽', '谨小慎微', '爱幻想',
  '精打细算', '重情义', '嘴硬心软', '外冷内热', '爱嚼舌根', '好奇心重', '认死理',
];

/** 读取稀遇触发概率(Setting.npc.rareProbability)。DB 不可达时回退默认。 */
export async function getRareProbability(): Promise<number> {
  const fallback = 0.04;
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'npc.rareProbability' } });
    if (!row) return fallback;
    const p = Number(row.value);
    return Number.isFinite(p) ? Math.max(0, Math.min(0.5, p)) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 抽取一个稀遇原型(若本轮命中)。读 DB 启用项,按 weight 加权随机。
 * DB 不可达或无启用项 → 返回 null(退化成普通 NPC,不阻断生成)。
 */
export async function pickRareArchetype(): Promise<RareArchetype | null> {
  try {
    const rows = await prisma.hiddenArchetype.findMany({ where: { enabled: true } });
    if (rows.length === 0) return null;
    const picked = weightedPick(rows.map((r) => ({ item: r, weight: r.weight })));
    return {
      key: picked.key,
      label: picked.label,
      flavor: picked.flavor,
      directive: picked.directive,
      stateOverride: (picked.stateOverride as Record<string, number> | null) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * 掷一次完整骰子:人口属性 + 是否命中稀遇。
 * probability 传入可避免重复读 Setting(由调用方 getRareProbability 后传入)。
 */
export async function rollNpcSeed(probability?: number): Promise<NpcSeed> {
  const p = probability ?? (await getRareProbability());
  const hit = Math.random() < p;
  const rare = hit ? await pickRareArchetype() : null;

  const age = weightedPick(AGE_BANDS);
  return {
    gender: weightedPick(GENDERS),
    ageBand: age.band,
    ageMin: age.min,
    ageMax: age.max,
    family: weightedPick(FAMILIES.map((f) => ({ item: f, weight: 1 }))),
    traits: pickDistinct(TRAITS, Math.random() < 0.5 ? 2 : 3),
    rare,
  };
}
