/**
 * 装备系统（搜打撤核心循环：局外经济 → 携带出击 → 撤离带出 / 死亡丢失）
 *
 * 设计意图：
 * - 「样本」同时是局内负担（§4.3 负载）与局外货币（§13.1），本模块是后者的去处。
 * - 装备是**可损耗资产**：买入即进仓库（永久），出击时从仓库选入「携带槽」；
 *   撤离成功携带槽里的装备与局内搜到的战利品一并留在仓库，死亡则一并丢失。
 *   于是"带好装备更容易打通，但死了更肉疼"成为真实的得失权衡。
 *
 * 与既有系统的关系：
 * - 不重复武器系统（§7 武器等级/形态，独立成长）；装备只提供**通用属性修正**。
 * - 效果统一在 GameScene 汇总后消费，本文件保持**不依赖 Phaser 的纯数据 + 纯函数**，
 *   所有经济规则（购买 / 装备 / 死亡丢失 / 撤离入库）都可在单测里直接断言。
 */

export type GearSlot = 'armor' | 'core' | 'bag' | 'boots';
export type GearRarity = 'common' | 'rare' | 'epic';

/** 装备提供的属性修正（全部可选，未填视为无加成）。 */
export interface GearEffects {
  /** 最大电子 HP（EHP）加成 */
  maxEhp?: number;
  /** 全局伤害倍率（>1 增伤） */
  damageMult?: number;
  /** 移速加成百分比（与染料/祝福/遗物同口径） */
  moveSpeedPct?: number;
  /** 冲刺冷却缩减比例（0-1，与冷却缩减同口径） */
  dashCdReduce?: number;
  /** 背包容量加成（§4.3 负载） */
  bagCapacity?: number;
  /** 样本收益倍率（>1 增收） */
  sampleMult?: number;
  /** 护盾上限加成 */
  maxShield?: number;
}

export interface GearDef {
  id: string;
  name: string;
  icon: string;
  slot: GearSlot;
  rarity: GearRarity;
  /** 局外购买价格（样本） */
  price: number;
  desc: string;
  effects: GearEffects;
}

export const GEAR_SLOT_META: Record<GearSlot, { name: string; icon: string }> = {
  armor: { name: '护甲', icon: '🛡' },
  core: { name: '核心', icon: '⚛' },
  bag: { name: '背包', icon: '🎒' },
  boots: { name: '靴子', icon: '🥾' }
};

/** 槽位顺序（UI 与效果遍历的唯一来源，避免各处硬编码顺序）。 */
export const GEAR_SLOTS: readonly GearSlot[] = ['armor', 'core', 'bag', 'boots'];

export const GEAR_RARITY_META: Record<GearRarity, { name: string; color: string }> = {
  common: { name: '普通', color: '#9CA3AF' },
  rare: { name: '稀有', color: '#60A5FA' },
  epic: { name: '史诗', color: '#C084FC' }
};

/**
 * 装备表：4 槽 × 3 档。价格随档位递增（普通 → 稀有 → 史诗），
 * 让"用样本换生存力"有明确的最优解梯度，而不是一步到位。
 */
export const gears: GearDef[] = [
  // ── 护甲：换生存 ──
  {
    id: 'armor-plate', name: '钛合金护板', icon: '🛡', slot: 'armor', rarity: 'common', price: 10,
    desc: '最大电子HP +25', effects: { maxEhp: 25 }
  },
  {
    id: 'armor-lead', name: '铅衬夹层', icon: '🛡', slot: 'armor', rarity: 'rare', price: 26,
    desc: '最大电子HP +60 · 护盾上限 +30', effects: { maxEhp: 60, maxShield: 30 }
  },
  {
    id: 'armor-tungsten', name: '钨钢装甲', icon: '🛡', slot: 'armor', rarity: 'epic', price: 60,
    desc: '最大电子HP +120 · 护盾上限 +60', effects: { maxEhp: 120, maxShield: 60 }
  },
  // ── 核心：换输出 ──
  {
    id: 'core-platinum', name: '铂催化剂', icon: '⚛', slot: 'core', rarity: 'common', price: 12,
    desc: '全局伤害 +8%', effects: { damageMult: 1.08 }
  },
  {
    id: 'core-iridium', name: '铱催化剂', icon: '⚛', slot: 'core', rarity: 'rare', price: 30,
    desc: '全局伤害 +18%', effects: { damageMult: 1.18 }
  },
  {
    id: 'core-palladium', name: '钯核芯', icon: '⚛', slot: 'core', rarity: 'epic', price: 66,
    desc: '全局伤害 +30%', effects: { damageMult: 1.3 }
  },
  // ── 背包：换容量（= 更耐得住贪） ──
  {
    id: 'bag-canvas', name: '帆布采样包', icon: '🎒', slot: 'bag', rarity: 'common', price: 8,
    desc: '背包容量 +30', effects: { bagCapacity: 30 }
  },
  {
    id: 'bag-crate', name: '强化采样箱', icon: '🎒', slot: 'bag', rarity: 'rare', price: 20,
    desc: '背包容量 +70', effects: { bagCapacity: 70 }
  },
  {
    id: 'bag-cryo', name: '低温样本仓', icon: '🎒', slot: 'bag', rarity: 'epic', price: 46,
    desc: '背包容量 +130 · 样本收益 +10%', effects: { bagCapacity: 130, sampleMult: 1.1 }
  },
  // ── 靴子：换机动 ──
  {
    id: 'boots-grip', name: '防滑胶靴', icon: '🥾', slot: 'boots', rarity: 'common', price: 8,
    desc: '移速 +6%', effects: { moveSpeedPct: 6 }
  },
  {
    id: 'boots-maglev', name: '磁悬浮鞋', icon: '🥾', slot: 'boots', rarity: 'rare', price: 22,
    desc: '移速 +14% · 冲刺冷却 -10%', effects: { moveSpeedPct: 14, dashCdReduce: 0.1 }
  },
  {
    id: 'boots-plasma', name: '等离子推进器', icon: '🥾', slot: 'boots', rarity: 'epic', price: 52,
    desc: '移速 +22% · 冲刺冷却 -20%', effects: { moveSpeedPct: 22, dashCdReduce: 0.2 }
  }
];

/** 装备 id 索引（避免每次 find 线性扫描）。 */
const GEAR_INDEX: Map<string, GearDef> = new Map(gears.map((g) => [g.id, g]));

export function getGear(id: string): GearDef | undefined {
  return GEAR_INDEX.get(id);
}

export function gearsForSlot(slot: GearSlot): GearDef[] {
  return gears.filter((g) => g.slot === slot);
}

/* ── 数据形态 ─────────────────────────────────────────── */

/** 仓库：装备 id → 持有数量（永久资产）。 */
export type GearWarehouse = Record<string, number>;
/** 携带槽：每槽最多 1 件（出击时生效，死亡丢失）。 */
export type GearLoadout = Record<GearSlot, string | null>;

export function defaultLoadout(): GearLoadout {
  return { armor: null, core: null, bag: null, boots: null };
}

export function emptyWarehouse(): GearWarehouse {
  return {};
}

/** 清洗外部数据（存档 / UI 输入）：丢弃未知 id、非法数量与非整数。 */
export function normalizeWarehouse(raw: unknown): GearWarehouse {
  const out: GearWarehouse = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, count] of Object.entries(raw as Record<string, unknown>)) {
    if (!GEAR_INDEX.has(id) || typeof count !== 'number' || !Number.isFinite(count)) continue;
    const n = Math.floor(count);
    if (n > 0) out[id] = n;
  }
  return out;
}

/** 清洗携带槽：id 必须存在、数量 > 0 且槽位匹配，否则置空。 */
export function normalizeLoadout(raw: unknown, warehouse: GearWarehouse): GearLoadout {
  const out = defaultLoadout();
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const slot of GEAR_SLOTS) {
    const id = src[slot];
    if (typeof id !== 'string') continue;
    const def = GEAR_INDEX.get(id);
    if (!def || def.slot !== slot) continue;
    if ((warehouse[id] ?? 0) <= 0) continue;
    out[slot] = id;
  }
  return out;
}

/* ── 纯规则函数（经济闭环，全部可直接单测）──────────────── */

export interface PurchaseResult {
  ok: boolean;
  reason?: 'unknown' | 'insufficient';
  warehouse: GearWarehouse;
  samples: number;
}

/** 用样本购买 1 件装备入仓库（样本不足 / 未知装备则原样返回）。 */
export function purchaseGear(warehouse: GearWarehouse, samples: number, id: string): PurchaseResult {
  const def = GEAR_INDEX.get(id);
  if (!def) return { ok: false, reason: 'unknown', warehouse, samples };
  if (samples < def.price) return { ok: false, reason: 'insufficient', warehouse, samples };
  return {
    ok: true,
    warehouse: { ...warehouse, [id]: (warehouse[id] ?? 0) + 1 },
    samples: samples - def.price
  };
}

/**
 * 切换携带槽（幂等）：
 * - 同槽同一件 → 卸下；
 * - 仓库里有货且槽位匹配 → 装备；
 * - 否则原样返回（不改变已有配置）。
 */
export function toggleEquipGear(
  loadout: GearLoadout,
  warehouse: GearWarehouse,
  slot: GearSlot,
  id: string
): GearLoadout {
  if (loadout[slot] === id) return { ...loadout, [slot]: null };
  const def = GEAR_INDEX.get(id);
  if (!def || def.slot !== slot) return loadout;
  if ((warehouse[id] ?? 0) <= 0) return loadout;
  return { ...loadout, [slot]: id };
}

/** 携带槽中的装备 id（按槽位顺序）。 */
export function loadoutGearIds(loadout: GearLoadout): string[] {
  return GEAR_SLOTS.map((s) => loadout[s]).filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** 仓库总件数（UI 顶部统计）。 */
export function warehouseCount(warehouse: GearWarehouse): number {
  return Object.values(warehouse).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
}

export interface DeathLossResult {
  warehouse: GearWarehouse;
  loadout: GearLoadout;
  /** 本次丢失的装备 id（含重复件）。 */
  lost: string[];
  /** 本次丢失的局内战利品件数。 */
  lostLoot: number;
}

/**
 * 死亡结算：携带槽里的装备各扣 1 件，局内搜到的战利品全部丢失。
 * 扣到 0 的槽位自动卸下，避免"装备还在但仓库已空"的错位状态。
 */
export function applyDeathLoss(
  warehouse: GearWarehouse,
  loadout: GearLoadout,
  carriedLoot: readonly string[] = []
): DeathLossResult {
  const nextWarehouse: GearWarehouse = { ...warehouse };
  const nextLoadout: GearLoadout = { ...loadout };
  const lost: string[] = [];
  for (const slot of GEAR_SLOTS) {
    const id = loadout[slot];
    if (!id) continue;
    lost.push(id);
    const left = (nextWarehouse[id] ?? 0) - 1;
    if (left > 0) nextWarehouse[id] = left;
    else delete nextWarehouse[id];
    if ((nextWarehouse[id] ?? 0) <= 0) nextLoadout[slot] = null;
  }
  const lostLoot = carriedLoot.filter((id) => GEAR_INDEX.has(id)).length;
  return { warehouse: nextWarehouse, loadout: nextLoadout, lost, lostLoot };
}

/** 撤离结算：局内搜到的战利品写入仓库（携带装备本身不消耗，自然保留）。 */
export function bankFoundGear(warehouse: GearWarehouse, found: readonly string[]): GearWarehouse {
  const next: GearWarehouse = { ...warehouse };
  for (const id of found) {
    if (!GEAR_INDEX.has(id)) continue;
    next[id] = (next[id] ?? 0) + 1;
  }
  return next;
}

/* ── 效果聚合 ─────────────────────────────────────────── */

/** 归一化后的装备效果（加成为 0、倍率为 1，便于直接参与运算）。 */
export interface ResolvedGearEffects {
  maxEhp: number;
  damageMult: number;
  moveSpeedPct: number;
  dashCdReduce: number;
  bagCapacity: number;
  sampleMult: number;
  maxShield: number;
}

export const EMPTY_GEAR_EFFECTS: ResolvedGearEffects = {
  maxEhp: 0,
  damageMult: 1,
  moveSpeedPct: 0,
  dashCdReduce: 0,
  bagCapacity: 0,
  sampleMult: 1,
  maxShield: 0
};

/** 汇总一组装备的效果：加性项相加，乘性项相乘（忽略未知 id）。 */
export function aggregateGearEffects(ids: readonly string[]): ResolvedGearEffects {
  const out: ResolvedGearEffects = { ...EMPTY_GEAR_EFFECTS };
  for (const id of ids) {
    const def = GEAR_INDEX.get(id);
    if (!def) continue;
    const e = def.effects;
    out.maxEhp += e.maxEhp ?? 0;
    out.moveSpeedPct += e.moveSpeedPct ?? 0;
    out.dashCdReduce += e.dashCdReduce ?? 0;
    out.bagCapacity += e.bagCapacity ?? 0;
    out.maxShield += e.maxShield ?? 0;
    out.damageMult *= e.damageMult ?? 1;
    out.sampleMult *= e.sampleMult ?? 1;
  }
  return out;
}

/** 随机掉落一件装备（rng 可注入保证确定性；默认按稀有度加权，越稀有越少见）。 */
const DROP_WEIGHTS: Record<GearRarity, number> = { common: 6, rare: 3, epic: 1 };

export function pickGearDrop(rng: () => number = Math.random): string {
  const total = gears.reduce((sum, g) => sum + DROP_WEIGHTS[g.rarity], 0);
  let r = rng() * total;
  for (const g of gears) {
    r -= DROP_WEIGHTS[g.rarity];
    if (r <= 0) return g.id;
  }
  return gears[gears.length - 1].id;
}

/**
 * 数据自检：供单测断言，避免手滑改出破坏经济梯度的数值。
 * 返回违规项列表（空数组表示通过）。
 */
export function validateGear(): string[] {
  const issues: string[] = [];
  const rarityOrder: GearRarity[] = ['common', 'rare', 'epic'];
  for (const slot of GEAR_SLOTS) {
    const list = gearsForSlot(slot);
    if (list.length === 0) issues.push(`槽位 ${slot} 没有任何装备`);
    list.sort((a, b) => rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity));
    for (let i = 1; i < list.length; i += 1) {
      // 同槽位内价格必须随稀有度递增，否则高档装备沦为"更贵更弱"
      if (list[i].price <= list[i - 1].price) {
        issues.push(`槽位 ${slot} 的价格未随稀有度递增：${list[i].id}`);
      }
    }
  }
  if (gears.some((g) => g.price <= 0)) issues.push('装备价格必须为正');
  return issues;
}