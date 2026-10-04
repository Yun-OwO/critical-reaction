/**
 * 氧化态 / 还原态修正（设计文档 §2.1「氧化态影响」）
 *
 * 这是本作核心支柱「电子即生命」的兑现：电子数不只是血条，
 * 它同时决定你此刻的攻击性、机动性与续航 ——
 *   - 氧化态（失去价电子）：伤害 +10%/电子，移速 +5%/电子，越残越猛
 *   - 还原态（持有自由电子）：冷却 -10%/电子，护盾上限 +10%/电子
 *   - 过氧化（只剩最后 1 颗价电子）：濒死，一次失误即终结
 *   - 过载：温度超过第二阈值（BALANCE.overload.tempThreshold）后的灼烧状态，
 *     每秒自损换取伤害强化。触发条件由调用方按温度判定后传入本模块，
 *     「自由电子满仓 = 过载」的旧规则已移除（满仓现在只受冷却/护盾加成封顶约束）。
 *
 * 全部为纯函数，便于单测与后续平衡调整；数值集中在 ELECTRON_STATE_RULES 与 BALANCE。
 */

export interface ElectronStateRules {
  /** 每失去 1 颗价电子，伤害提升比例 */
  damagePerLost: number;
  /** 每失去 1 颗价电子，移速提升百分比 */
  movePerLost: number;
  /** 每持有 1 颗自由电子，冷却缩减百分比 */
  cdPerExtra: number;
  /** 每持有 1 颗自由电子，护盾上限提升百分比 */
  shieldPerExtra: number;
  /** 过载时的额外伤害倍率（自损速率在 BALANCE.overload.selfDamagePerSec） */
  overloadDamageMult: number;
}

export const ELECTRON_STATE_RULES: ElectronStateRules = {
  damagePerLost: 0.1,
  movePerLost: 5,
  cdPerExtra: 10,
  shieldPerExtra: 10,
  overloadDamageMult: 1.25
};

export interface ElectronState {
  /** 已失去的价电子数 */
  lost: number;
  /** 持有的额外（自由）电子数 */
  extra: number;
  /** 出伤倍率（1 = 无修正） */
  damageMult: number;
  /** 移速加成百分比 */
  moveSpeedBonus: number;
  /** 冷却缩减百分比 */
  cdReduction: number;
  /** 护盾上限加成百分比 */
  shieldBonusPct: number;
  /** 过氧化：濒死（只剩最后一颗价电子） */
  overOxidized: boolean;
  /** 过载：温度超限（每秒自损，伤害强化；判定在 BALANCE.overload.tempThreshold） */
  overloaded: boolean;
  /** 展示用状态名 */
  label: '基态' | '氧化态' | '还原态' | '过氧化' | '过载';
}

/**
 * 由当前电子账目推导状态修正。
 * 参数全部夹取为非负整数，避免负血/负上限等异常输入产生反向加成。
 * @param overloaded 温度是否已超过过载阈值（由调用方按 BALANCE.overload 判定）
 */
export function describeElectronState(
  valence: number,
  maxValence: number,
  freeElectrons: number,
  maxFreeElectrons: number,
  overloaded = false,
  rules: ElectronStateRules = ELECTRON_STATE_RULES
): ElectronState {
  const maxV = Math.max(0, Math.round(maxValence));
  const v = Math.max(0, Math.min(Math.round(valence), maxV));
  const maxFree = Math.max(0, Math.round(maxFreeElectrons));
  const free = Math.max(0, Math.min(Math.round(freeElectrons), maxFree));

  const lost = Math.max(0, maxV - v);
  const extra = free;

  const overOxidized = v <= 1 && maxV > 0;

  let damageMult = 1 + lost * rules.damagePerLost;
  if (overloaded) damageMult *= rules.overloadDamageMult;

  let label: ElectronState['label'] = '基态';
  if (overloaded) label = '过载';
  else if (overOxidized) label = '过氧化';
  else if (lost > 0) label = '氧化态';
  else if (extra > 0) label = '还原态';

  return {
    lost,
    extra,
    damageMult,
    moveSpeedBonus: lost * rules.movePerLost,
    cdReduction: extra * rules.cdPerExtra,
    shieldBonusPct: extra * rules.shieldPerExtra,
    overOxidized,
    overloaded,
    label
  };
}

/** 周期性结算是否应在本帧触发（每秒一次，与帧率解耦）。 */
export function overloadTick(elapsedSinceLastTick: number): boolean {
  return elapsedSinceLastTick >= 1;
}
