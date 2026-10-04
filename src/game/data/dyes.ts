/**
 * 染料与光谱 DNA 系统
 *
 * 9种基础染料，每种有独特战斗效果。
 * 混色系统：任意主副搭配都会混色 —— 6 条特殊配方优先，其余走 RGB 均值通用混色。
 */

export type DyeEffectType = 'electron_ox' | 'electron_re' | 'speed' | 'dot' | 'cd' | 'crit_bonus' | 'armor_break' | 'aoe' | 'temp';

/** 单条染料效果（混色染料可同时携带两条）。 */
export interface DyeEffect {
  type: DyeEffectType;
  value: number;
}

export interface DyeData {
  id: string;
  name: string;
  color: string;
  hex: number;
  wavelength: string;
  purity: number;
  /** 颜色效果描述 */
  effect: string;
  /** 颜色效果类型 */
  effectType: DyeEffectType;
  /** 效果数值 */
  effectValue: number;
  /** 混色染料的第二条效果（主/副色各贡献一份，按槽位权重生效） */
  secondEffect?: DyeEffect;
}

export const dyes: DyeData[] = [
  { id: 'D01', name: '红染', color: '#EF4444', hex: 0xEF4444, wavelength: '620-750nm', purity: 1, effect: '氧化夺取+1', effectType: 'electron_ox', effectValue: 1 },
  { id: 'D02', name: '橙染', color: '#F97316', hex: 0xF97316, wavelength: '590-620nm', purity: 1, effect: 'AOE范围+20%', effectType: 'aoe', effectValue: 0.2 },
  { id: 'D03', name: '黄染', color: '#EAB308', hex: 0xEAB308, wavelength: '570-590nm', purity: 1, effect: '速度+15%', effectType: 'speed', effectValue: 15 },
  { id: 'D04', name: '绿染', color: '#22C55E', hex: 0x22C55E, wavelength: '520-570nm', purity: 1, effect: '攻击附带3秒毒', effectType: 'dot', effectValue: 3 },
  { id: 'D05', name: '青染', color: '#06B6D4', hex: 0x06B6D4, wavelength: '495-520nm', purity: 1, effect: '还原夺取+1', effectType: 'electron_re', effectValue: 1 },
  { id: 'D06', name: '蓝染', color: '#3B82F6', hex: 0x3B82F6, wavelength: '450-495nm', purity: 1, effect: 'CD-15%', effectType: 'cd', effectValue: 15 },
  { id: 'D07', name: '紫染', color: '#8B5CF6', hex: 0x8B5CF6, wavelength: '380-450nm', purity: 1, effect: '暴击额外夺取+5', effectType: 'crit_bonus', effectValue: 5 },
  { id: 'D08', name: '紫外染', color: '#6A0DAD', hex: 0x6A0DAD, wavelength: '<380nm', purity: 1, effect: '破甲：氧化额外夺取+2', effectType: 'armor_break', effectValue: 2 },
  { id: 'D09', name: '红外染', color: '#991B1B', hex: 0x991B1B, wavelength: '>750nm', purity: 1, effect: '暴击额外夺取+8', effectType: 'crit_bonus', effectValue: 8 }
];

/** 混色配方：主色+副色→结果 */
interface MixRecipe {
  primary: string;
  secondary: string;
  resultId: string;
  resultName: string;
  resultColor: string;
  resultHex: number;
}

export interface MixResult extends MixRecipe {
  /** 混色产生的具体效果（底槽 25% 权重生效），由结果染料定义推导，保证与实战一致 */
  resultEffect: string;
}

export const MIX_TABLE: MixRecipe[] = [
  { primary: 'D01', secondary: 'D06', resultId: 'D07', resultName: '紫', resultColor: '#8B5CF6', resultHex: 0x8B5CF6 },
  { primary: 'D01', secondary: 'D03', resultId: 'D02', resultName: '橙', resultColor: '#F97316', resultHex: 0xF97316 },
  { primary: 'D06', secondary: 'D03', resultId: 'D04', resultName: '绿', resultColor: '#22C55E', resultHex: 0x22C55E },
  { primary: 'D01', secondary: 'D05', resultId: 'white', resultName: '白', resultColor: '#F0F0FF', resultHex: 0xF0F0FF },
  { primary: 'D06', secondary: 'D04', resultId: 'D05', resultName: '青', resultColor: '#06B6D4', resultHex: 0x06B6D4 },
  { primary: 'D07', secondary: 'D03', resultId: 'gold', resultName: '金', resultColor: '#FFD700', resultHex: 0xFFD700 },
];

/** 互补色克制表：攻击互补色敌人+30%伤害 */
export const COMPLEMENTARY: Record<string, string> = {
  D01: 'D05', D05: 'D01',
  D06: 'D02', D02: 'D06',
  D04: 'D07', D07: 'D04',
};

/** 染色槽：主100%/副50%/底25% */
export const DYE_SLOT_MULTIPLIERS = [1.0, 0.5, 0.25] as const;

/** 特殊配方的具名混色染料（结果色无对应基础染料时使用）。 */
const NAMED_MIX_DYES: Record<string, DyeData> = {
  white: {
    id: 'white', name: '白', color: '#F0F0FF', hex: 0xF0F0FF, wavelength: '全谱', purity: 0.25,
    effect: '氧化夺取+1 + 还原夺取+1', effectType: 'electron_ox', effectValue: 1,
    secondEffect: { type: 'electron_re', value: 1 }
  },
  gold: {
    id: 'gold', name: '金', color: '#FFD700', hex: 0xFFD700, wavelength: '全谱', purity: 0.25,
    effect: '暴击额外夺取+5 + 速度+15%', effectType: 'crit_bonus', effectValue: 5,
    secondEffect: { type: 'speed', value: 15 }
  }
};

/** 按 ID 查询染料（含特殊具名混色与通用混色染料）。 */
export function getDye(id: string): DyeData | undefined {
  const base = dyes.find((d) => d.id === id);
  if (base) return base;
  const named = NAMED_MIX_DYES[id];
  if (named) return named;
  const m = /^MX-([^-]+)-(.+)$/.exec(id);
  return m ? getGenericMixDye(m[1], m[2]) : undefined;
}

/** 尝试混色（仅特殊配方），返回结果或 null。 */
export function tryMix(primaryId: string, secondaryId: string): MixRecipe | null {
  return MIX_TABLE.find((m) =>
    (m.primary === primaryId && m.secondary === secondaryId) ||
    (m.primary === secondaryId && m.secondary === primaryId)
  ) ?? null;
}

/* ── 通用混色：任意主副搭配都有结果 ────────────────────────── */

const genericMixCache = new Map<string, DyeData>();

/** 由混合后的色相推导颜色名（用于通用混色结果命名）。 */
function hueName(hex: number): string {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.08) return max > 0.8 ? '白' : max < 0.25 ? '黑' : '灰';
  let h: number;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  const stops: [number, string][] = [
    [15, '红'], [45, '橙'], [70, '黄'], [160, '绿'], [200, '青'], [255, '蓝'], [290, '紫'], [330, '品红'], [361, '红']
  ];
  for (const [bound, name] of stops) if (h < bound) return name;
  return '红';
}

/** RGB 均值混色。 */
function blendHex(hexA: number, hexB: number): number {
  const r = (((hexA >> 16) & 0xff) + ((hexB >> 16) & 0xff)) / 2;
  const g = (((hexA >> 8) & 0xff) + ((hexB >> 8) & 0xff)) / 2;
  const b = ((hexA & 0xff) + (hexB & 0xff)) / 2;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/**
 * 生成通用混色染料：颜色取两色 RGB 均值，效果由两色各贡献一份。
 * 与主副顺序无关（按 id 排序），保证任意搭配都有确定且唯一的结果。
 */
export function getGenericMixDye(idA: string, idB: string): DyeData | undefined {
  const a = dyes.find((d) => d.id === idA);
  const b = dyes.find((d) => d.id === idB);
  if (!a || !b) return undefined;
  const [first, second] = a.id <= b.id ? [a, b] : [b, a];
  const key = `${first.id}|${second.id}`;
  const cached = genericMixCache.get(key);
  if (cached) return cached;

  const hex = blendHex(first.hex, second.hex);
  const same = first.id === second.id;
  const dye: DyeData = {
    id: `MX-${first.id}-${second.id}`,
    name: same ? `${first.name}·纯` : `${hueName(hex)}混`,
    color: `#${hex.toString(16).padStart(6, '0').toUpperCase()}`,
    hex,
    wavelength: `${first.wavelength} ∩ ${second.wavelength}`,
    purity: 0.25,
    effect: same
      ? `${first.effect} 叠加（合计 50%）`
      : `${first.effect} + ${second.effect}（各 25%）`,
    effectType: first.effectType,
    effectValue: first.effectValue,
    secondEffect: { type: second.effectType, value: second.effectValue }
  };
  genericMixCache.set(key, dye);
  return dye;
}

/** 结果染料的展示效果文本：直接取染料定义，特殊配方额外标注底槽 25% 权重。 */
function mixEffectText(resultId: string, special: boolean): string {
  const dye = getDye(resultId);
  const base = dye ? dye.effect : '未知效果';
  return special ? `${base}（底槽 25%）` : base;
}

/** 解析任意主副搭配的混色结果：特殊配方优先，其余走通用混色。 */
export function resolveMix(primaryId: string, secondaryId: string): MixResult | null {
  const special = tryMix(primaryId, secondaryId);
  if (special) {
    return {
      ...special,
      primary: primaryId,
      secondary: secondaryId,
      resultEffect: mixEffectText(special.resultId, true)
    };
  }
  const dye = getGenericMixDye(primaryId, secondaryId);
  if (!dye) return null;
  return {
    primary: primaryId,
    secondary: secondaryId,
    resultId: dye.id,
    resultName: dye.name,
    resultColor: dye.color,
    resultHex: dye.hex,
    resultEffect: mixEffectText(dye.id, false)
  };
}

/** 任意主副搭配的展示用颜色与效果。 */
export interface MixPreview {
  /** 展示颜色 */
  color: string;
  /** 结果名 */
  name: string;
  /** 具体效果描述 */
  effect: string;
}

export function getMixPreview(primaryId: string, secondaryId: string): MixPreview {
  const mix = resolveMix(primaryId, secondaryId);
  if (!mix) return { color: '#67e8f9', name: '—', effect: '未知染料' };
  const special = tryMix(primaryId, secondaryId) !== null;
  return { color: mix.resultColor, name: mix.resultName, effect: `${mix.resultEffect} · ${special ? '特殊配方' : '通用混色'}` };
}

/** 检查两个颜色是否为互补色（克制关系）。 */
export function isComplementary(id1: string, id2: string): boolean {
  return COMPLEMENTARY[id1] === id2;
}
