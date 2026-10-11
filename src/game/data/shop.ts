/**
 * 局内经济：催化券产出、诡商货架、撤离结算、定向投资
 * —— 全部是纯函数，不引用 Phaser、不直接改 gameState。
 *
 * 设计来源：
 * - 明日方舟集成战略「前瞻性投资」：存款的**储备余额跨探索继承**，用来解锁收藏品；
 *   我们照搬这个结构，但把「纯解锁进度」原样保留——存钱让你这局更弱，这是**故意的**。
 * - Hades 的可预期性：所有定价取 5 的倍数（`BALANCE.economy2.priceAnchor`），
 *   玩家能心算「还差 15 就够买那个」；Charon 的 150 Obols 就是这个道理。
 *
 * **局内券 / 局外样本必须分开**：券必须在撤离结算那一步死掉，否则就变成第二套局外货币，
 * 投资系统也就失去了「牺牲本局战力换跨局进度」的意义。
 */

import { BALANCE } from './balance';
import { gears, GEAR_SLOTS } from './gear';
import { dyes } from './dyes';
import type { EventContext } from './events';

const E2 = BALANCE.economy2;

// ── 催化券 ──────────────────────────────────────────────────────────────────

/** 房间/宝箱的券产出。`depth` 是层内房间序号（0 起）。 */
export function couponsForRoom(depth: number, elite: boolean): number {
  const base = E2.couponsPerRoom + E2.couponsPerDepth * Math.max(0, depth);
  return Math.round(base * (elite ? E2.eliteMultiplier : 1));
}

export function couponsForChest(): number {
  return E2.couponsPerChest;
}

export function canSpend(coupons: number, price: number): boolean {
  return price >= 0 && coupons >= price;
}

export function spendCoupons(coupons: number, price: number): number {
  return canSpend(coupons, price) ? coupons - price : coupons;
}

/**
 * 撤离结算：剩余催化券折算成局外样本。
 * 死亡则是 0 —— 券只在「活着撤离」时兑现，这是整个投资闭环的支点。
 */
export function settleCoupons(coupons: number, extracted: boolean): number {
  if (!extracted) return 0;
  return Math.max(0, Math.floor(coupons * E2.couponToSample));
}

// ── 定向投资（对标 IS 前瞻性投资）───────────────────────────────────────────

/** 投资余额跨局继承，满了就不再增长。返回新的储备余额与实际投入量。 */
export function investCoupons(
  reserve: number,
  coupons: number,
  all: boolean
): { reserve: number; spent: number } {
  const room = Math.max(0, E2.investReserveCap - reserve);
  if (room <= 0) return { reserve, spent: 0 };
  const want = all ? coupons : Math.min(E2.investUnit, coupons);
  const spent = Math.max(0, Math.min(want, room));
  return { reserve: reserve + spent, spent };
}

// ── 色谱图鉴：累计投资解锁 ──────────────────────────────────────────────────

export interface SpectrumEntry {
  id: string;
  name: string;
  desc: string;
  /** 累计投资门槛 */
  cost: number;
}

export const SPECTRUM_ENTRIES: SpectrumEntry[] = [
  { id: 'sp-siphon', name: '虹吸管', desc: '每局开始 +8 催化券', cost: 30 },
  { id: 'sp-rack', name: '货架空架', desc: '诡商货架 +1 格', cost: 60 },
  { id: 'sp-purity', name: '纯化滤芯', desc: '所有染料纯度 +10%', cost: 100 },
  { id: 'sp-anneal', name: '退火夹具', desc: '撤离结算券折算率 +0.2', cost: 160 },
  { id: 'sp-atlas', name: '元素图鉴册', desc: '事件房必定出现稀有事件', cost: 240 },
  { id: 'sp-lens', name: '分光镜', desc: '进化槽主槽权重 1.0 → 1.2', cost: 340 },
  { id: 'sp-quench', name: '淬冷环', desc: '每局首战免疫熔毁', cost: 480 },
  { id: 'sp-ledger', name: '投资账簿', desc: '投资不再占用局内券（改为结算时投入）', cost: 660 },
  { id: 'sp-core', name: '裂解核心', desc: '每局 +1 个自由电子上限', cost: 880 }
];

/** 按累计投资额返回已解锁的图鉴 id 列表。 */
export function unlockedSpectrum(totalInvested: number): string[] {
  return SPECTRUM_ENTRIES.filter((e) => totalInvested >= e.cost).map((e) => e.id);
}

/** 下一个尚未解锁的图鉴项（用于局外界面显示进度）。 */
export function nextSpectrumGoal(totalInvested: number): SpectrumEntry | null {
  return SPECTRUM_ENTRIES.find((e) => totalInvested < e.cost) ?? null;
}

// ── 诡商货架 ────────────────────────────────────────────────────────────────

export type ShopKind = 'supply' | 'gear' | 'dye' | 'evolution' | 'purify';

export interface ShopSlot {
  id: string;
  kind: ShopKind;
  name: string;
  desc: string;
  /** 定价，必须是 `priceAnchor` 的倍数 */
  price: number;
  rarity: 'common' | 'rare' | 'epic';
  /**
   * 商品携带的载荷（`kind` 决定含义）：
   * - supply: 操作码
   * - gear: 装备 id
   * - dye: 染料 id
   * - evolution: 染料 id（对该色 +1 进化等级）
   */
  payload: string | number;
}

export type Rng = () => number;

const SUPPLY_TABLE: { code: number; name: string; desc: string }[] = [
  { code: 1, name: '电子扩容', desc: '自由电子上限 +1，并立即获得 1' },
  { code: 2, name: '还原充能', desc: 'EHP 回满' },
  { code: 3, name: '循环冷凝', desc: '温度 −20' },
  { code: 4, name: '扩容背架', desc: '负载上限 +1' }
];

function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
}

function makeSupply(rng: Rng): ShopSlot {
  return makeSupplyFixed(pick(SUPPLY_TABLE, rng));
}

function makeSupplyFixed(s: (typeof SUPPLY_TABLE)[number]): ShopSlot {
  return { id: `sup-${s.code}`, kind: 'supply', name: s.name, desc: s.desc, price: E2.prices.supply, rarity: 'common', payload: s.code };
}

function makeGear(rng: Rng): ShopSlot {
  const slot = pick(GEAR_SLOTS, rng);
  const candidates = gears.filter((g) => g.slot === slot);
  const def = pick(candidates.length ? candidates : gears, rng);
  const price = def.rarity === 'epic' ? E2.prices.gearEpic : def.rarity === 'rare' ? E2.prices.gearRare : E2.prices.gearCommon;
  return { id: `gear-${def.id}`, kind: 'gear', name: def.name, desc: def.effects ? `${def.name}（${def.rarity}）` : `${def.name}（${def.rarity}）`, price, rarity: def.rarity, payload: def.id };
}

function makeDye(rng: Rng): ShopSlot {
  const def = pick(dyes, rng);
  return { id: `dye-${def.id}`, kind: 'dye', name: def.name, desc: `${def.name} · ${def.effect}`, price: E2.prices.dye, rarity: 'common', payload: def.id };
}

function makeEvolution(rng: Rng, ctx: EventContext): ShopSlot {
  // 优先给玩家「已经染色过」的染料——进化是个需要投入的长线，
  // 卖没见过的颜色等于让玩家为自己的无知付钱。
  const owned = ctx.dyeCount > 0 ? dyes.filter(() => ctx.dyeCount > 0) : dyes;
  const def = pick(owned.length ? owned : dyes, rng);
  return {
    id: `evo-${def.id}`,
    kind: 'evolution',
    name: `${def.name} 催化剂`,
    desc: `${def.name} 进化等级 +1`,
    price: E2.prices.evolution,
    rarity: 'rare',
    payload: def.id
  };
}

/** 提纯台：每层必出的稀有保底。作用是「催化已有染料的进化」，即局内长线投入。 */
function makePurify(rng: Rng): ShopSlot {
  const def = pick(dyes, rng);
  return {
    id: `pur-${def.id}`,
    kind: 'purify',
    name: '提纯台',
    desc: `${def.name} 进化等级 +1（每层保底稀有机会）`,
    price: E2.prices.evolution,
    rarity: 'rare',
    payload: def.id
  };
}

/**
 * 生成一层诡商的货架。
 *
 * 货架类型按层数推进（L1 只有补给 → L2 出装备 → L3 出染料 → L4+ 出进化材料），
 * 并保证**至少 `guaranteedRarePerLayer` 件稀有**（对标 Hades 的骷髅房提稀有——
 * 把「变强」绑在一个可识别的位置，而不是随机撒概率）。
 *
 * 商品 id 必须唯一（它是购买去重的依据），而装备/染料都可能重复抽中，
 * 所以最后统一去重：冲突位回退成尚未出现的补给品。
 */
export function rollShop(layer: number, ctx: EventContext, rng: Rng): ShopSlot[] {
  const slots: ShopSlot[] = [];
  const n = E2.shopSlots;
  // 先铺保底稀有，否则保底位会被后面的普通商品挤掉
  for (let i = 0; i < E2.guaranteedRarePerLayer; i += 1) slots.push(makePurify(rng));

  while (slots.length < n) {
    const roll = rng();
    if (layer >= E2.evolutionFromLayer && roll < 0.25) slots.push(makeEvolution(rng, ctx));
    else if (layer >= E2.dyeFromLayer && roll < 0.5) slots.push(makeDye(rng));
    else if (layer >= E2.gearFromLayer && roll < 0.75) slots.push(makeGear(rng));
    else slots.push(makeSupply(rng));
  }

  // 去重：把重复 id 的格子换成还没用过的补给品
  const used = new Set<string>();
  for (let i = 0; i < slots.length; i += 1) {
    if (!used.has(slots[i].id)) {
      used.add(slots[i].id);
      continue;
    }
    const free = SUPPLY_TABLE.find((s) => !used.has(`sup-${s.code}`));
    if (!free) continue; // 补给品已被占满（货架格数 ≤ 4 时不会发生）
    const filler = makeSupplyFixed(free);
    slots[i] = filler;
    used.add(filler.id);
  }
  return slots;
}

/** 定价是否满足可心算性约束（单测与 UI 提示都会用到）。 */
export function priceIsAnchor(price: number): boolean {
  return Number.isFinite(price) && price > 0 && price % E2.priceAnchor === 0;
}