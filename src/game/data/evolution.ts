/**
 * 进化系统 —— 装备属性的「颜色推导」层
 *
 * 设计来源：`github.com/1026073226/colorist`（KubeJS 魔法书模组）的 `startup_scripts/lib.js`。
 * 那套设计的要点是：**装备没有作者预设的属性表**，属性由「你往槽位里混了什么颜色」实时算出来
 * （`VALUE_COUNTER`：红→攻击、绿→生命、蓝→消耗降、亮→暴击率、暗→暴击伤害）。
 *
 * 本项目沿用它的骨架，但把 RGB 三通道翻译成化学语义，并对「纯度/杂质」做了修正：
 * colorist 用亮度当纯度，但化学上的「纯」指**色相不被稀释**，不是亮度——
 * 红+青互补混合后是灰色，亮度不低却是浑浊的。故这里用 HSV 饱和度作纯度。
 *
 * 本文件是**纯函数层**：不引用 Phaser、不持有状态、不做 IO。
 * 目的是让「配比 → 属性」这一整张决策表可以被完整单测，
 * 也让后续接入（染色工作台、战斗结算）不必重复推导逻辑。
 */

import { DYE_SLOT_MULTIPLIERS, getDye } from './dyes';

/** 每件装备开放的进化槽数量（主/副/底，对齐既有染色槽权重）。 */
export const EVOLUTION_SLOT_COUNT = DYE_SLOT_MULTIPLIERS.length;

/** 装备的进化槽：数组下标即槽位，null 表示空槽。 */
export type EvolutionSlots = readonly (string | null)[];

/** 混合后的颜色（各通道 ∈ [0,1]）。 */
export interface EvolutionColor {
  r: number;
  g: number;
  b: number;
}

/** 由混合色推导出的属性修正。全部为**乘区倍率**，空槽时全部为恒等值。 */
export interface EvolutionStats {
  /** 伤害倍率（氧化力） */
  damageMult: number;
  /** 生命/护盾倍率（键能） */
  hpMult: number;
  /** 升温倍率（催化控温），<1 表示更不容易过热 */
  heatMult: number;
  /** 附加暴击率（纯度） */
  critRateBonus: number;
  /** 暴击伤害倍率（主通道强度） */
  critMult: number;
  /** 供 UI 展示的中间量 */
  color: EvolutionColor;
  /** 色相饱和度 ∈ [0,1]：0=浑浊灰，1=纯色 */
  saturation: number;
  /** 主通道强度 ∈ [0,1] */
  dominant: number;
  /** 实际生效的槽位数（用于 UI 判断「还没进化」） */
  filledSlots: number;
}

/** 空槽状态下的属性修正——恰好是全恒等，函数无需特判空槽。 */
export const NEUTRAL_EVOLUTION_STATS: EvolutionStats = {
  damageMult: 1,
  hpMult: 1,
  heatMult: 1,
  critRateBonus: 0,
  critMult: 1,
  color: { r: 0, g: 0, b: 0 },
  saturation: 0,
  dominant: 0,
  filledSlots: 0
};

// ── 数值参数 ────────────────────────────────────────────────────────────────
// `NONLINEAR_EXP = 1.1`（沿用 colorist）是**超线性**（指数 > 1）：通道越浓、额外收益越陡。
// 注意这与「边际递减」相反——第一版注释写反了，是被单测的数值抓出来的。
// 它和「副槽权重只有主槽的一半」叠在一起，产生的实际玩法张力是：
//   稀释很贵（副槽最多只占 1/3，混色会明显拉平主通道），而集中很赚（超线性）。
// 于是每瓶染料都是一次真抉择：继续往同一个通道堆，还是开第二条线。
const DAMAGE_GAIN = 0.35;      // 满红 → 伤害 +35%
const HP_GAIN = 0.25;          // 满绿 → 生命 +25%
const HEAT_CUT = 0.45;         // 满蓝 → 升温 -45%
const CRIT_RATE_GAIN = 0.25;   // 纯色 → 暴击率 +25%
const CRIT_DMG_GAIN = 0.6;     // 主通道满强度 → 暴击伤害 ×1.6
const NONLINEAR_EXP = 1.1;

/**
 * 按槽位权重混合出最终颜色。
 *
 * 权重沿用 `DYE_SLOT_MULTIPLIERS`（主 1.0 / 副 0.5 / 底 0.25），
 * 归一化后做加权平均 —— 与 colorist 的 `CALC_ATTRS` 同构，
 * 差别只在于它那边是等权平均。
 *
 * **权重是相对的，不是绝对的**，这有两个必须记住的后果：
 * 1. 只填一种染料时，混合色恒等于该染料原色，放哪个槽都一样；
 *    「主槽更强」只在与其他染料比较时才成立。
 * 2. 权重构成等比数列，所以 `[A, B, 空]` 与 `[空, A, B]` 混合结果**完全相同**
 *    （1:0.5 与 0.5:0.25 是同一个比例）。真正改变配比的是把 B 从副槽挪到底槽。
 *
 * 未知的染料 id 按「纯黑」处理而不是抛错：存档里的 id 可能来自旧版本或已被删的染料，
 * 让它退化成中性贡献，远好过整局存档读不出来。
 */
export function mixEvolutionColor(slots: EvolutionSlots): EvolutionColor {
  let r = 0;
  let g = 0;
  let b = 0;
  let wsum = 0;
  for (let i = 0; i < EVOLUTION_SLOT_COUNT; i += 1) {
    const id = slots[i];
    if (!id) continue;
    const dye = getDye(id);
    if (!dye) continue;
    const w = DYE_SLOT_MULTIPLIERS[i] ?? 0;
    if (w <= 0) continue;
    r += ((dye.hex >> 16) & 0xff) / 255 * w;
    g += ((dye.hex >> 8) & 0xff) / 255 * w;
    b += (dye.hex & 0xff) / 255 * w;
    wsum += w;
  }
  if (wsum <= 0) return { r: 0, g: 0, b: 0 };
  return { r: r / wsum, g: g / wsum, b: b / wsum };
}

/**
 * 颜色 → 属性修正。这是整个进化系统唯一的推导入口。
 *
 * 纯度用 HSV 饱和度 `(max-min)/max` 而非亮度：互补色混合后是灰色，
 * 亮度不低但色相已被稀释，正是「副反应污染了主反应」的化学含义。
 */
export function computeEvolutionStats(slots: EvolutionSlots): EvolutionStats {
  const color = mixEvolutionColor(slots);
  const maxc = Math.max(color.r, color.g, color.b);
  const minc = Math.min(color.r, color.g, color.b);
  const saturation = maxc > 0 ? (maxc - minc) / maxc : 0;
  // 只统计**能解析出染料**的槽：存档里可能残留已删/改名的 id，
  // 把它们算成「已进化」会让 UI 对着一件其实没有任何属性的装备说谎。
  let filled = 0;
  for (let i = 0; i < EVOLUTION_SLOT_COUNT; i += 1) {
    const id = slots[i];
    if (id && getDye(id)) filled += 1;
  }

  return {
    damageMult: 1 + Math.pow(color.r, NONLINEAR_EXP) * DAMAGE_GAIN,
    hpMult: 1 + Math.pow(color.g, NONLINEAR_EXP) * HP_GAIN,
    heatMult: 1 - color.b * HEAT_CUT,
    critRateBonus: Math.sqrt(saturation) * CRIT_RATE_GAIN,
    critMult: 1 + maxc * CRIT_DMG_GAIN,
    color,
    saturation,
    dominant: maxc,
    filledSlots: filled
  };
}

/** 两个属性修正的乘区合成（用于把「装备进化」与「祝福/染色槽」叠在一起）。 */
export function combineEvolution(a: EvolutionStats, b: EvolutionStats): EvolutionStats {
  return {
    damageMult: a.damageMult * b.damageMult,
    hpMult: a.hpMult * b.hpMult,
    heatMult: a.heatMult * b.heatMult,
    critRateBonus: a.critRateBonus + b.critRateBonus,
    critMult: a.critMult * b.critMult,
    color: {
      r: (a.color.r + b.color.r) / 2,
      g: (a.color.g + b.color.g) / 2,
      b: (a.color.b + b.color.b) / 2
    },
    saturation: (a.saturation + b.saturation) / 2,
    dominant: Math.max(a.dominant, b.dominant),
    filledSlots: Math.max(a.filledSlots, b.filledSlots)
  };
}

/** 把属性修正翻成一句给玩家看的说明（纯字符串，便于单测断言文案）。 */
export function describeEvolution(stats: EvolutionStats): string {
  if (stats.filledSlots === 0) return '未进化';
  const parts: string[] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (Math.abs(stats.damageMult - 1) > 0.005) parts.push(`伤害 ${pct(stats.damageMult)}`);
  if (Math.abs(stats.hpMult - 1) > 0.005) parts.push(`生命 ${pct(stats.hpMult)}`);
  if (Math.abs(stats.heatMult - 1) > 0.005) parts.push(`升温 ${pct(stats.heatMult)}`);
  if (stats.critRateBonus > 0.005) parts.push(`暴击率 +${pct(stats.critRateBonus)}`);
  if (Math.abs(stats.critMult - 1) > 0.005) parts.push(`暴伤 ${pct(stats.critMult)}`);
  if (parts.length === 0) return '已染色（无有效属性）';
  return parts.join(' · ');
}

/**
 * 枚举把某个染料注入各槽位后的属性变化，用于染色工作台的「预览」。
 * 空槽列表的结果就是原样注入，调用方直接拿来做提示文案。
 */
export function previewInject(slots: EvolutionSlots, dyeId: string): EvolutionStats[] {
  const out: EvolutionStats[] = [];
  for (let i = 0; i < EVOLUTION_SLOT_COUNT; i += 1) {
    const next = slots.slice();
    next[i] = dyeId;
    out.push(computeEvolutionStats(next));
  }
  return out;
}