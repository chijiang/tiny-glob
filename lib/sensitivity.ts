import { SensitivityResult, WikiEvent } from './types';

// 层 1:确定性关键词/类别规则。零成本,命中即降级。
const TITLE_KEYWORDS = [
  'atomic bombing',
  'holocaust',
  'genocide',
  'massacre',
  'nuclear disaster',
  'terrorist attack',
  'terror attack',
  'concentration camp',
  'ethnic cleansing',
  'war crime',
  'famine',
];

const CATEGORY_PREFIXES = [
  'Category:Massacres',
  'Category:Genocides',
  'Category:Nuclear disasters',
  'Category:War crimes',
  'Category:Terrorist incidents',
  'Category:Concentration camps',
  'Category:The Holocaust',
  'Category:Atomic bombings of Hiroshima and Nagasaki',
  'Category:Famines',
];

// 战役/轰炸/围城:标题以此开头判定为重大军事冲突
const WAR_TITLE_STARTS = ['battle of', 'bombing of', 'siege of'];

const KW_CN: Record<string, string> = {
  'atomic bombing': '原子弹轰炸',
  holocaust: '大屠杀',
  genocide: '种族灭绝',
  massacre: '屠杀',
  'nuclear disaster': '核灾难',
  'terrorist attack': '恐怖袭击',
  'terror attack': '恐怖袭击',
  'concentration camp': '集中营',
  'ethnic cleansing': '种族清洗',
  'war crime': '战争罪行',
  famine: '大饥荒',
};

export function ruleBasedSensitive(events: WikiEvent[]): SensitivityResult | null {
  for (const e of events) {
    const titleLower = e.title.toLowerCase();

    for (const kw of TITLE_KEYWORDS) {
      if (titleLower.includes(kw)) {
        return { sensitive: true, reason: `事件《${e.title}》涉及${KW_CN[kw] ?? kw}类敏感主题` };
      }
    }

    for (const cat of e.categories) {
      for (const prefix of CATEGORY_PREFIXES) {
        if (cat.startsWith(prefix)) {
          return { sensitive: true, reason: `事件《${e.title}》归类于敏感类别 ${cat}` };
        }
      }
    }

    for (const start of WAR_TITLE_STARTS) {
      if (titleLower.startsWith(start)) {
        return { sensitive: true, reason: `事件《${e.title}》属于重大战役/轰炸类敏感主题` };
      }
    }
  }
  return null;
}
