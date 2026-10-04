/**
 * 负载系统（设计文档 §4.3）
 *
 * 「搜打撤」的核心张力来源：带出的样本同时是战利品与负担。
 * 携带越多，移速越低、冲刺冷却越长 —— 于是"再多打一间房"与"趁还能跑先撤"成为真实抉择。
 *
 * 负载 = 携带样本 / 背包容量；分段倍率严格按 §4.3 表格实现。
 */

export interface LoadBand {
  /** 该档位对应的负载上限（比值，>1 用 Infinity 表示） */
  maxRatio: number;
  /** 档位名（HUD 展示） */
  label: string;
  /** 移速倍率 */
  speedMult: number;
  /** 冲刺冷却倍率（越大越慢） */
  dashCdMult: number;
}

/** §4.3 负载档位表：0–25% / 25–50% / 50–75% / 75–100% / >100%。 */
export const LOAD_BANDS: readonly LoadBand[] = [
  { maxRatio: 0.25, label: '轻载', speedMult: 1.0, dashCdMult: 1.0 },
  { maxRatio: 0.5, label: '常载', speedMult: 0.9, dashCdMult: 1.15 },
  { maxRatio: 0.75, label: '重载', speedMult: 0.75, dashCdMult: 1.35 },
  { maxRatio: 1.0, label: '超载', speedMult: 0.55, dashCdMult: 1.6 },
  { maxRatio: Number.POSITIVE_INFINITY, label: '满仓', speedMult: 0.4, dashCdMult: 2.0 }
];

/**
 * 背包基础容量（样本单位）。
 * 定 120 的依据：一次完整三层搜刮大约产出 60-120 样本（击杀 1+温度奖励、
 * 精英房 5+2×层、撤离奖励），因此典型局会落在「常载—重载」区间，
 * 只有贪到第三层还不撤才会进入「满仓」，惩罚曲线才成立而不是一路挨罚。
 */
export const BASE_BAG_CAPACITY = 120;
/** 催化剂台「扩容背包」单次提升量与售价。 */
export const BAG_UPGRADE_AMOUNT = 20;
export const BAG_UPGRADE_COST = 6;

export interface LoadState {
  /** 携带样本 */
  carried: number;
  /** 背包容量 */
  capacity: number;
  /** 负载比值（可 >1，表示已超载） */
  ratio: number;
  /** 负载百分比（整数，HUD 用） */
  percent: number;
  band: LoadBand;
}

/** 由携带量推导负载状态。容量非法时按 1 处理，避免除零产生 Infinity 倍率。 */
export function describeLoad(carried: number, capacity: number): LoadState {
  const c = Math.max(0, Math.round(carried));
  const cap = capacity > 0 ? capacity : 1;
  const ratio = c / cap;
  const band = LOAD_BANDS.find((b) => ratio < b.maxRatio) ?? LOAD_BANDS[LOAD_BANDS.length - 1];
  return { carried: c, capacity: cap, ratio, percent: Math.round(ratio * 100), band };
}

/** 负载对移速的倍率（越低越慢）。 */
export function loadSpeedMult(carried: number, capacity: number): number {
  return describeLoad(carried, capacity).band.speedMult;
}

/** 负载对冲刺冷却的倍率（越大冷却越长）。 */
export function loadDashCdMult(carried: number, capacity: number): number {
  return describeLoad(carried, capacity).band.dashCdMult;
}