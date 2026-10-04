import { BAG_UPGRADE_AMOUNT, BAG_UPGRADE_COST } from '../combat/load';
import { pickGearDrop } from './gear';

export type EnemyKind = 'chaser' | 'ranged' | 'tank' | 'healer' | 'acid' | 'sniper' | 'summoner' | 'shielder';

export type RoomType = 'combat' | 'treasure' | 'shop' | 'extraction' | 'boss' | 'finalBoss' | 'pool' | 'elite' | 'event' | 'dye';
export type RunRoomState = 'enter' | 'combat' | 'cleared' | 'choose' | 'travel';

export interface RoomEnemyDef {
  key: string;
  kind: EnemyKind;
  baseHp: number;
  baseSpeed: number;
  weight: number;
}

export interface RoomWaveConfig {
  count: number;
  composition: RoomEnemyDef[];
  boss?: boolean;
  /** 精英波：敌人 HP/移速额外强化（精英房专属） */
  elite?: boolean;
}

export interface RoomReward {
  kind: 'samples' | 'freeElectron' | 'temperature';
  amount: number;
}

export interface ShopOffer {
  cost: number;
  item: 'electronMax' | 'heal' | 'temperature' | 'bag';
  amount: number;
}

/**
 * 化学仪器（设计文档 §10.3）：事件房里的一次性交互装置。
 * 每台仪器都是一次明确的取舍 —— 用温度压力换样本，或用样本换稳定。
 */
export interface InstrumentOffer {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 温度变化（正为升温，负为降温） */
  temperature: number;
  /** 样本变化 */
  samples: number;
  /** 是否还原充能：补满价电子并回满 EHP */
  refill?: boolean;
}

/** 事件房仪器池：全部为纯数据，便于单测与平衡调整。 */
export const INSTRUMENT_OFFERS: InstrumentOffer[] = [
  { id: 'bunsen', name: '本生灯', icon: '🔥', desc: '加热：温度 +25，样本 +4', temperature: 25, samples: 4 },
  { id: 'ice-bath', name: '冰浴', icon: '❄', desc: '降温：温度 -25，样本 +1', temperature: -25, samples: 1 },
  { id: 'still', name: '蒸馏器', icon: '⚗', desc: '提纯：样本 +3', temperature: 0, samples: 3 },
  { id: 'electrolytic', name: '电解池', icon: '⚡', desc: '还原充能：补满价电子并回满电子HP', temperature: 0, samples: 0, refill: true },
  { id: 'reactor', name: '核反应堆', icon: '☢', desc: '高危：温度 +35，样本 +8', temperature: 35, samples: 8 }
];

/** 随机取一台仪器（rng 可注入保证确定性）。 */
export function pickInstrument(rng: () => number = Math.random): InstrumentOffer {
  return INSTRUMENT_OFFERS[Math.min(INSTRUMENT_OFFERS.length - 1, Math.floor(rng() * INSTRUMENT_OFFERS.length))];
}

/**
 * 染料房（设计文档 §10.4）：进入后按当前染色槽状态呈现两种形态 ——
 * - 副槽/底槽有空位 → 染缸：3 种基础染料任选其一填入空槽
 * - 两槽已满 → 调色盘：把主槽 + 副槽混色写入底槽
 */
export interface DyeOffer {
  /** 染缸可选的基础染料 id（3 选 1） */
  choices: string[];
}

/** 基础染料 id（与 dyes.ts 的 9 色一一对应，此处只存 id 避免耦合）。 */
export const BASE_DYE_IDS = ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09'] as const;

/** 随机取 3 种互不重复的基础染料（rng 可注入保证确定性）。 */
export function pickDyeChoices(rng: () => number = Math.random): string[] {
  const pool: string[] = [...BASE_DYE_IDS];
  const picked: string[] = [];
  while (picked.length < 3 && pool.length > 0) {
    picked.push(pool.splice(Math.min(pool.length - 1, Math.floor(rng() * pool.length)), 1)[0]);
  }
  return picked;
}

export interface RoomDef {
  id: number;
  type: RoomType;
  depth: number;
  layer: number;
  waves: RoomWaveConfig[];
  reward: RoomReward | null;
  shop: ShopOffer | null;
  /** 事件房的一次性仪器（其他房间为 null） */
  instrument: InstrumentOffer | null;
  /** 染料房的染缸选项（其他房间为 null） */
  dye: DyeOffer | null;
  /**
   * 装备掉落（搜打撤的「搜」）：撤离成功写入局外仓库，死亡丢失。
   * 目前只在宝藏房与精英房产出，其他房间为 null。
   */
  gearDrop: string | null;
  boss?: boolean;
}

export interface RoomTheme {
  boundary: number;
  banner: string;
  icon: string;
}

export const ROOM_THEMES: Record<RoomType, RoomTheme> = {
  combat: { boundary: 0x67e8f9, banner: '战斗房', icon: '剑' },
  treasure: { boundary: 0xfde047, banner: '宝藏房', icon: '箱' },
  shop: { boundary: 0xa78bfa, banner: '商店房', icon: '币' },
  extraction: { boundary: 0x06b6d4, banner: '撤离房', icon: '门' },
  boss: { boundary: 0xff4d6d, banner: 'Boss', icon: '骷' },
  finalBoss: { boundary: 0xff2200, banner: '最终决战', icon: '★' },
  pool: { boundary: 0x34d399, banner: '水池', icon: '水' },
  elite: { boundary: 0xffb020, banner: '精英房', icon: '☠' },
  event: { boundary: 0xe879f9, banner: '事件房', icon: '?' },
  dye: { boundary: 0xc084fc, banner: '染料房', icon: '染' }
};

/** 每层房间数（不含 Boss 房）。 */
const ROOMS_PER_LAYER = [4, 5, 6];
/** 每层 Boss 后是否提供撤离选择。 */
const LAYER_EXTRACTION = [true, true, false];
/** 每层难度缩放。 */
const LAYER_HP_SCALE = [1.0, 1.5, 2.0];
const LAYER_SPEED_SCALE = [0, 16, 36];
const LAYER_WAVE_SCALE = [0, 1, 2];

export const COMBAT_POOL: RoomEnemyDef[] = [
  { key: 'free-radical', kind: 'chaser',   baseHp: 45, baseSpeed: 68, weight: 1.0 },
  { key: 'oxidizer',     kind: 'ranged',   baseHp: 55, baseSpeed: 72, weight: 1.0 },
  { key: 'polymer',      kind: 'tank',     baseHp: 80, baseSpeed: 42, weight: 0.8 },
  { key: 'acid-drop',    kind: 'acid',     baseHp: 38, baseSpeed: 64, weight: 0.7 },
  { key: 'reducer',      kind: 'healer',   baseHp: 70, baseSpeed: 54, weight: 0.5 },
  { key: 'photom',       kind: 'sniper',   baseHp: 32, baseSpeed: 60, weight: 0.6 },
  { key: 'monomer',      kind: 'summoner', baseHp: 50, baseSpeed: 48, weight: 0.4 },
  { key: 'catalyst',     kind: 'shielder', baseHp: 65, baseSpeed: 52, weight: 0.5 }
];

let nextRoomId = 1;

/** 生成房间战斗波次配置。 */
export function makeCombatWaves(layer: number, boss = false): RoomWaveConfig[] {
  // 每波在前一层基准上额外 +1 敌人，1 层已加成 1 → 1 层更密集，2 层适中
  const extra = (LAYER_WAVE_SCALE[layer] ?? 0) + 1;
  const base = { count: Math.min(4 + extra, 8), composition: COMBAT_POOL };
  if (boss) {
    return [
      base,
      { count: base.count + 1, composition: COMBAT_POOL },
      { count: 1, composition: COMBAT_POOL, boss: true }
    ];
  }
  // 每层至少 2 波（1 层波数更多，压力更大）
  return extra <= 1 ? [base, { count: base.count + 1, composition: COMBAT_POOL }] : [base, { count: base.count + 1, composition: COMBAT_POOL }, { count: base.count, composition: COMBAT_POOL }];
}

/** 精英房波次：敌人更少但更硬（HP×2、移速 +14），共 2 波，奖励更丰厚。 */
export function makeEliteWaves(layer: number): RoomWaveConfig[] {
  const extra = Math.min(LAYER_WAVE_SCALE[layer] ?? 0, 1);
  const base: RoomWaveConfig = { count: 2 + extra, composition: COMBAT_POOL, elite: true };
  return [base, { ...base, count: base.count + 1 }];
}

/**
 * 组装一波敌人：count >= 3 时强制包含近战/远程/坦克各一，
 * 其余按 weight 加权填充，返回长度恰为 count。
 */
export function buildComposition(cfg: RoomWaveConfig, count: number, rng: () => number = Math.random): RoomEnemyDef[] {
  const result: RoomEnemyDef[] = [];
  if (count >= 3) {
    for (const want of [COMBAT_POOL[0], COMBAT_POOL[1], COMBAT_POOL[2]]) {
      const found = cfg.composition.find((d) => d.key === want.key);
      if (found) result.push(found);
    }
  }
  const weightTotal = cfg.composition.reduce((sum, d) => sum + d.weight, 0) || 1;
  while (result.length < count) {
    let r = rng() * weightTotal;
    let pick = cfg.composition[0];
    for (const d of cfg.composition) {
      r -= d.weight;
      if (r <= 0) {
        pick = d;
        break;
      }
    }
    result.push(pick);
  }
  return result;
}

/** 创建房间定义（id 自增）。 */
export function createRoom(type: RoomType, depth: number, layer: number, rng: () => number = Math.random): RoomDef {
  const room: RoomDef = { id: nextRoomId++, type, depth, layer, waves: [], reward: null, shop: null, instrument: null, dye: null, gearDrop: null };
  if (type === 'combat' || type === 'extraction') {
    // 撤离房与战斗房同构：先清怪，清空后才解锁通风橱撤离
    room.waves = makeCombatWaves(layer);
  }
  if (type === 'elite') {
    // 精英房：少而强的敌人，清空后给一笔样本（层数越高越多），并有较高概率掉装备
    room.waves = makeEliteWaves(layer);
    room.reward = { kind: 'samples', amount: 5 + layer * 2 };
    if (rng() < 0.4) room.gearDrop = pickGearDrop(rng);
  }
  if (type === 'event') {
    // 事件房（化学仪器）：无战斗，一次明确的取舍
    room.instrument = pickInstrument(rng);
  }
  if (type === 'dye') {
    // 染料房：无战斗，染缸 3 选 1（槽位已满时运行时转为调色盘）
    room.dye = { choices: pickDyeChoices(rng) };
  }
  if (type === 'treasure') {
    const roll = rng();
    if (roll < 0.5) room.reward = { kind: 'samples', amount: 3 };
    else if (roll < 0.8) room.reward = { kind: 'freeElectron', amount: 1 };
    else if (roll < 0.9) room.reward = { kind: 'temperature', amount: 20 };
    // 10% 出装备：宝箱是局内最稳定的「搜」来源
    else room.gearDrop = pickGearDrop(rng);
  }
  if (type === 'shop') {
    // 商店报价：电子上限 / 恢复 / 降温 / 背包扩容（§4.3 负载的样本去处）
    const roll = rng();
    room.shop = roll < 0.3
      ? { cost: 5, item: 'electronMax', amount: 1 }
      : roll < 0.55
        ? { cost: 3, item: 'heal', amount: 100 }
        : roll < 0.8
          ? { cost: 4, item: 'temperature', amount: 20 }
          : { cost: BAG_UPGRADE_COST, item: 'bag', amount: BAG_UPGRADE_AMOUNT };
  }
  return room;
}

/** 创建 Boss 房。 */
export function createBossRoom(layer: number, rng: () => number = Math.random): RoomDef {
  const room = createRoom('boss', ROOMS_PER_LAYER[layer], layer, rng);
  room.boss = true;
  room.waves = makeCombatWaves(layer, true);
  return room;
}

/** 创建最终 Boss 房（第 3 层通关后的最终决战）。 */
export function createFinalBossRoom(rng: () => number = Math.random): RoomDef {
  const room = createRoom('finalBoss', 0, 3, rng);
  room.boss = true;
  room.waves = [
    { count: 5, composition: COMBAT_POOL },
    { count: 1, composition: COMBAT_POOL, boss: true }
  ];
  return room;
}

/** 起始房恒为第 0 层深度 0 的战斗房。 */
export function generateStartRoom(rng: () => number = Math.random): RoomDef {
  return createRoom('combat', 0, 0, rng);
}

/**
 * 生成当前房间的出口门（下一房间定义列表）。
 *
 * Hades 式三层结构：
 * - 普通房间：2-3 扇门（战斗/宝藏/商店）
 * - Boss 房清空后：撤离门 + 下一层入口门（或最终 Boss）
 * - 最终 Boss 房：无出口，通关结算
 */
export function generateRoomDoors(room: RoomDef, rng: () => number = Math.random): RoomDef[] {
  // 最终 Boss 房没有出口
  if (room.type === 'finalBoss') return [];

  // Boss 房清空后：撤离 + 下一层
  if (room.type === 'boss') {
    const doors: RoomDef[] = [];
    if (LAYER_EXTRACTION[room.layer]) {
      doors.push(createRoom('extraction', room.depth + 1, room.layer, rng));
    }
    if (room.layer < 2) {
      // 下一层入口（第0/1层Boss后）
      doors.push(createRoom('combat', 0, room.layer + 1, rng));
    } else {
      // 第2层Boss后 → 最终 Boss
      doors.push(createFinalBossRoom(rng));
    }
    return doors;
  }

  // 普通房间：根据层内剩余房间数决定门数
  const roomsInLayer = ROOMS_PER_LAYER[room.layer];
  const depthLeft = roomsInLayer - room.depth;

  if (depthLeft <= 1) {
    // 层末 → Boss 房
    return [createBossRoom(room.layer, rng)];
  }
  if (depthLeft === 2) {
    // 倒数第二间：Boss + 宝藏
    return [createBossRoom(room.layer, rng), createRoom('treasure', room.depth + 1, room.layer, rng)];
  }

  // 普通：3 扇门（含精英房/事件房/染料房）
  const doors: RoomDef[] = [];
  const types: RoomType[] = ['combat', 'combat', 'combat', 'treasure', 'shop', 'pool', 'elite', 'event', 'dye'];
  for (let i = 0; i < 3; i++) {
    const t = types[Math.floor(rng() * types.length)];
    doors.push(createRoom(t, room.depth + 1, room.layer, rng));
  }
  return doors;
}

/** 获取层名。 */
export function getLayerName(layer: number): string {
  return ['第一层 · 初级实验室', '第二层 · 中试车间', '第三层 · 临界反应堆'][layer] ?? '未知层';
}

/** 获取层内进度描述。 */
export function getLayerProgress(layer: number, depth: number): string {
  const total = ROOMS_PER_LAYER[layer] + 1; // +1 for boss
  return `${Math.min(depth + 1, total)}/${total}`;
}

/** 获取层难度倍率（HP 缩放）。 */
export function getLayerHpScale(layer: number): number {
  return LAYER_HP_SCALE[layer] ?? 1.0;
}

/** 获取层难度倍率（速度偏移）。 */
export function getLayerSpeedScale(layer: number): number {
  return LAYER_SPEED_SCALE[layer] ?? 0;
}

/* ── 撤离点类型（设计文档 §6.4）：温度越高，收益越高，风险越大 ────────── */

export type ExtractionKind = 'vent' | 'quench' | 'stabilize' | 'hot' | 'hidden';

export interface ExtractionDef {
  id: ExtractionKind;
  name: string;
  icon: string;
  /** 可用温度上限（null = 无限制） */
  maxTemperature: number | null;
  /** 可用温度下限（null = 无限制） */
  minTemperature: number | null;
  /** 需要的自由电子（试剂）数量 */
  reagentCost: number;
  /** 需要已击败过 Boss 的次数 */
  bossKills: number;
  /** 样本奖励倍率 */
  rewardMult: number;
  /** 样本损坏比例（0-1，撤离时按此比例损失） */
  lossRate: number;
  /** 稳定化倒计时（秒） */
  holdSeconds: number;
  /** 展示色 */
  color: number;
  desc: string;
}

export const EXTRACTION_DEFS: Record<ExtractionKind, ExtractionDef> = {
  vent: {
    id: 'vent', name: '通风橱', icon: '门',
    maxTemperature: 39, minTemperature: null,
    reagentCost: 0, bossKills: 0,
    rewardMult: 1, lossRate: 0, holdSeconds: 5, color: 0x67e8f9,
    desc: '温度 <40 可用 · 标准奖励'
  },
  quench: {
    id: 'quench', name: '淬火池', icon: '水',
    maxTemperature: null, minTemperature: null,
    reagentCost: 0, bossKills: 0,
    rewardMult: 1, lossRate: 0.3, holdSeconds: 5, color: 0x3b82f6,
    desc: '任意温度可用 · 样本损坏 30%'
  },
  stabilize: {
    id: 'stabilize', name: '稳定化反应', icon: '⚗',
    maxTemperature: null, minTemperature: null,
    reagentCost: 1, bossKills: 0,
    rewardMult: 1.4, lossRate: 0, holdSeconds: 8, color: 0x34d399,
    desc: '消耗 1 自由电子 · 样本完好'
  },
  hot: {
    id: 'hot', name: '高温撤离', icon: '🔥',
    maxTemperature: null, minTemperature: 80,
    reagentCost: 0, bossKills: 0,
    rewardMult: 2, lossRate: 0.15, holdSeconds: 10, color: 0xff8a4c,
    desc: '温度 >80 · 双倍奖励'
  },
  hidden: {
    id: 'hidden', name: '隐藏撤离', icon: '★',
    maxTemperature: null, minTemperature: null,
    reagentCost: 0, bossKills: 1,
    rewardMult: 2.5, lossRate: 0, holdSeconds: 12, color: 0xffd700,
    desc: '需击败过 Boss · 稀有样本'
  }
};

/** 撤离点可用性判定依据的实时状态。 */
export interface ExtractionContext {
  temperature: number;
  freeElectrons: number;
  bossKills: number;
}

/** 当前条件下该撤离点是否可用。 */
export function canUseExtraction(def: ExtractionDef, ctx: ExtractionContext): boolean {
  if (def.maxTemperature !== null && ctx.temperature >= def.maxTemperature) return false;
  if (def.minTemperature !== null && ctx.temperature < def.minTemperature) return false;
  if (ctx.freeElectrons < def.reagentCost) return false;
  if (ctx.bossKills < def.bossKills) return false;
  return true;
}

/**
 * 挑选当前条件下收益最高的可用撤离点。
 * 优先级：隐藏 > 高温 > 稳定化 > 通风橱 > 淬火池（淬火池恒可用，作为保底）。
 */
export function pickExtraction(ctx: ExtractionContext): ExtractionDef {
  const priority: ExtractionKind[] = ['hidden', 'hot', 'stabilize', 'vent'];
  for (const id of priority) {
    if (canUseExtraction(EXTRACTION_DEFS[id], ctx)) return EXTRACTION_DEFS[id];
  }
  return EXTRACTION_DEFS.quench;
}

/** 按撤离点结算最终到手的样本数（含奖励倍率与损坏比例）。 */
export function settleExtractionSamples(baseSamples: number, def: ExtractionDef): number {
  return Math.max(1, Math.round(baseSamples * def.rewardMult * (1 - def.lossRate)));
}
