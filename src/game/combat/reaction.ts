/**
 * 反应层数与失控规则（借鉴卫戍协议 bonds 层系统 + 11-limits 官方上限设计）。
 *
 * 三个纯函数职责：
 * 1. addLayers        —— 层数累计（999 硬上限：反失控第一闸）
 * 2. claimMilestones  —— 里程碑按序领取（25/50/100/…，只往前推进，不回头）
 * 3. isRunawayCancel  —— 失控取消（借鉴「单发 ≥30 万伤害直接归零」：对高血量目标
 *    单发夺取超限 → 整击取消。戏剧化为临界反应主题规则：过量试剂加入会让反应失控湮灭）。
 *
 * 全部为纯函数，便于单测与平衡调整；数值默认值在 BALANCE.reaction / BALANCE.combat。
 */

export interface LayerMilestone {
  /** 触发层数 */
  at: number;
  reward: 'samples' | 'electron' | 'cool' | 'damage';
  amount: number;
  /** 结算文案（飘字用） */
  label: string;
}

export interface MilestoneClaim {
  /** 领取后的已领里程碑数量 */
  claimedCount: number;
  /** 本次新领取的里程碑（按触发顺序） */
  rewards: LayerMilestone[];
}

/** 层数累计：负增益忽略，硬上限封顶（反失控：999 层后不再增长）。 */
export function addLayers(current: number, gain: number, cap: number): number {
  if (gain <= 0) return Math.max(0, current);
  return Math.min(cap, current + gain);
}

/**
 * 按序领取里程碑：层数只增不减，claimedCount 单调推进；
 * 一次大额增长（如 Boss +20 层）可跨越多个里程碑并按序全部领取。
 */
export function claimMilestones(
  total: number,
  claimedCount: number,
  milestones: readonly LayerMilestone[]
): MilestoneClaim {
  const rewards: LayerMilestone[] = [];
  let claimed = Math.max(0, claimedCount);
  while (claimed < milestones.length && total >= milestones[claimed].at) {
    rewards.push(milestones[claimed]);
    claimed += 1;
  }
  return { claimedCount: claimed, rewards };
}

/** 层数伤害倍率：1 + 每层加成 × 层数 + 里程碑永久加成。 */
export function reactionDamageMult(layers: number, damagePerLayer: number, milestoneBonus: number): number {
  return 1 + Math.max(0, layers) * damagePerLayer + Math.max(0, milestoneBonus);
}

export interface RunawayRule {
  /** 单发夺取颗数阈值（≥ 此值视为"过量试剂"） */
  threshold: number;
  /** 目标电子比例 ≥ 此值视为"满仓"（未满仓时反应有缓冲空间，不触发取消） */
  fullRatio: number;
}

/**
 * 失控取消判定：对高储备目标单发夺取超限 → 整击取消（一颗都拿不到）。
 * 设计意图（卫戍协议 11-limits 的「取消而非截断」）：无限堆单发倍率反而亏输出，
 * 玩家必须"先用普攻削减储备，再倾泻爆发"——把数值上限做成负向决策。
 */
export function isRunawayCancel(
  stealCount: number,
  targetCurrent: number,
  targetCapacity: number,
  rule: RunawayRule
): boolean {
  if (stealCount < rule.threshold) return false;
  if (targetCapacity <= 0) return false;
  return targetCurrent >= targetCapacity * rule.fullRatio;
}
