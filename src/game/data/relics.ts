/**
 * 遗物系统数据结构
 *
 * 12 个遗物，每个 3 个升级等级。
 *
 * **多槽激活（本次改造）**：原先只能激活 1 个，这直接堵死了「套装联动」——
 * 联动的前提是多个遗物同时生效。改为按稀有度给槽位：
 *   普通槽 ×2 + 稀有槽 ×1 + 传说槽 ×1 = 4 个可同时激活的遗物。
 * 槽位限制的意义在于**防止无脑全开**：普通遗物数值温和可以多带，
 * 传说遗物一个就足够改变打法，只给一个槽。
 *
 * **套装联动**：同时激活特定组合时触发额外效果（见 `relicSets`）。
 * 联动是纯数据声明 + 纯函数判定，可全量单测。
 */

export type RelicRarity = 'common' | 'rare' | 'legendary';

/**
 * 每种稀有度可同时激活的数量。
 *
 * 稀有给 2 个槽（而不是 1），是因为套装「原电池」要求同时激活 r06/r07 两个稀有遗物；
 * 若稀有只有 1 槽，这条联动玩家永远凑不齐，等于写了死内容。
 * 这条约束已被单测守住：`套装组合不得超出槽位配额`。
 */
export const RELIC_SLOTS: Record<RelicRarity, number> = {
  common: 2,
  rare: 2,
  legendary: 1
};

/** 解锁进度来源类型 */
export type UnlockKind = 'samples' | 'kills' | 'depth' | 'layer' | 'boss';

export interface UnlockRequirement {
  kind: UnlockKind;
  /** 达标数值 */
  target: number;
  /** 人类可读描述 */
  label: string;
}

export interface RelicEffect {
  type: string;
  value: number;
  description: string;
}

export interface RelicDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  rarity: RelicRarity;
  color: number;
  /** 解锁条件（各遗物各不相同） */
  unlock: UnlockRequirement;
  /** 3个等级的效果 */
  tiers: [RelicEffect, RelicEffect, RelicEffect];
}

/** 解锁判定依据的累计进度数据 */
export interface RelicProgress {
  /** 累计样本 */
  samples: number;
  /** 累计击杀 */
  kills: number;
  /** 单次最深到达的房间深度（第几层内计数，0 起） */
  bestDepth: number;
  /** 单次最高到达的层（0-2，3 表示最终Boss） */
  bestLayer: number;
  /** 击败 BOSS 次数 */
  bossKills: number;
}

export const EMPTY_RELIC_PROGRESS: RelicProgress = {
  samples: 0,
  kills: 0,
  bestDepth: 0,
  bestLayer: 0,
  bossKills: 0
};

/** 判断遗物是否已解锁。 */
export function isRelicUnlocked(def: RelicDef, progress: RelicProgress): boolean {
  switch (def.unlock.kind) {
    case 'samples': return progress.samples >= def.unlock.target;
    case 'kills': return progress.kills >= def.unlock.target;
    case 'depth': return progress.bestDepth >= def.unlock.target;
    case 'layer': return progress.bestLayer >= def.unlock.target;
    case 'boss': return progress.bossKills >= def.unlock.target;
    default: return false;
  }
}

export const relicDefs: RelicDef[] = [
  {
    id: 'r01',
    name: '电子心脏',
    icon: '❤️',
    description: '每击败一个敌人，恢复0.5生命',
    rarity: 'common',
    color: 0xff5c7a,
    unlock: { kind: 'kills', target: 10, label: '达成某个隐藏条件后解锁' },
    tiers: [
      { type: 'heal_on_kill', value: 0.5, description: '每击败一个敌人，恢复0.5生命' },
      { type: 'heal_on_kill', value: 1.0, description: '每击败一个敌人，恢复1.0生命' },
      { type: 'heal_on_kill', value: 1.5, description: '每击败一个敌人，恢复1.5生命' }
    ]
  },
  {
    id: 'r02',
    name: '共价键手套',
    icon: '🧤',
    description: '攻击速度+15%',
    rarity: 'common',
    color: 0xfbbf24,
    unlock: { kind: 'samples', target: 5, label: '达成某个隐藏条件后解锁' },
    tiers: [
      { type: 'atk_speed', value: 15, description: '攻击速度+15%' },
      { type: 'atk_speed', value: 25, description: '攻击速度+25%' },
      { type: 'atk_speed', value: 40, description: '攻击速度+40%' }
    ]
  },
  {
    id: 'r03',
    name: '催化剂碎片',
    icon: '⚗️',
    description: '技能冷却-20%',
    rarity: 'common',
    color: 0xa78bfa,
    unlock: { kind: 'depth', target: 1, label: '达成某个隐藏条件后解锁' },
    tiers: [
      { type: 'cd_reduction', value: 20, description: '技能冷却-20%' },
      { type: 'cd_reduction', value: 30, description: '技能冷却-30%' },
      { type: 'cd_reduction', value: 45, description: '技能冷却-45%' }
    ]
  },
  {
    id: 'r04',
    name: '轨道稳定器',
    icon: '🛡️',
    description: '护盾上限+50',
    rarity: 'rare',
    color: 0x67e8f9,
    unlock: { kind: 'samples', target: 15, label: '达成某个隐藏条件后解锁' },
    tiers: [
      { type: 'max_shield', value: 50, description: '护盾上限+50' },
      { type: 'max_shield', value: 100, description: '护盾上限+100' },
      { type: 'max_shield', value: 200, description: '护盾上限+200' }
    ]
  },
  {
    id: 'r05',
    name: '电子加速器',
    icon: '⚡',
    description: '移动速度+20%',
    rarity: 'rare',
    color: 0xfde047,
    unlock: { kind: 'kills', target: 40, label: '达成某个隐藏条件后解锁' },
    tiers: [
      { type: 'move_speed', value: 20, description: '移动速度+20%' },
      { type: 'move_speed', value: 35, description: '移动速度+35%' },
      { type: 'move_speed', value: 50, description: '移动速度+50%' }
    ]
  },
  {
    id: 'r06',
    name: '氧化催化剂',
    icon: '🔥',
    description: '氧化伤害+30%',
    rarity: 'rare',
    color: 0xef4444,
    unlock: { kind: 'layer', target: 1, label: '达成某个隐藏条件后解锁' },
    tiers: [
      { type: 'oxidize_bonus', value: 30, description: '氧化伤害+30%' },
      { type: 'oxidize_bonus', value: 50, description: '氧化伤害+50%' },
      { type: 'oxidize_bonus', value: 80, description: '氧化伤害+80%' }
    ]
  },
  {
    id: 'r07',
    name: '还原稳定器',
    icon: '❄️',
    description: '还原伤害+30%',
    rarity: 'rare',
    color: 0x22c55e,
    unlock: { kind: 'depth', target: 3, label: '达成某个隐藏条件后解锁' },
    tiers: [
      { type: 'reduce_bonus', value: 30, description: '还原伤害+30%' },
      { type: 'reduce_bonus', value: 50, description: '还原伤害+50%' },
      { type: 'reduce_bonus', value: 80, description: '还原伤害+80%' }
    ]
  },
  {
    id: 'r08',
    name: '量子共振器',
    icon: '🌀',
    description: '暴击率+10%',
    rarity: 'legendary',
    color: 0xf97316,
    unlock: { kind: 'layer', target: 2, label: '达成某个隐藏条件后解锁' },
    tiers: [
      { type: 'crit_chance', value: 10, description: '暴击率+10%' },
      { type: 'crit_chance', value: 20, description: '暴击率+20%' },
      { type: 'crit_chance', value: 35, description: '暴击率+35%' }
    ]
  },
  {
    id: 'r09',
    name: '价电子护盾',
    icon: '🔰',
    description: '受到伤害时，30%概率反弹50%伤害',
    rarity: 'legendary',
    color: 0x8b5cf6,
    unlock: { kind: 'boss', target: 1, label: '达成某个隐藏条件后解锁' },
    tiers: [
      { type: 'thorns', value: 30, description: '受到伤害时，30%概率反弹50%伤害' },
      { type: 'thorns', value: 45, description: '受到伤害时，45%概率反弹75%伤害' },
      { type: 'thorns', value: 60, description: '受到伤害时，60%概率反弹100%伤害' }
    ]
  },
  {
    id: 'r10',
    name: '反应核心',
    icon: '💎',
    description: '价电子上限+2',
    rarity: 'legendary',
    color: 0xfbbf24,
    unlock: { kind: 'boss', target: 3, label: '达成某个隐藏条件后解锁' },
    tiers: [
      { type: 'max_valence', value: 2, description: '价电子上限+2' },
      { type: 'max_valence', value: 3, description: '价电子上限+3' },
      { type: 'max_valence', value: 5, description: '价电子上限+5' }
    ]
  },
  {
    id: 'r11',
    name: '活化电极',
    icon: '🔋',
    description: '自由电子上限+1',
    rarity: 'common',
    color: 0x38bdf8,
    unlock: { kind: 'samples', target: 30, label: '达成某个隐藏条件后解锁' },
    tiers: [
      { type: 'max_electron', value: 1, description: '自由电子上限+1' },
      { type: 'max_electron', value: 2, description: '自由电子上限+2' },
      { type: 'max_electron', value: 3, description: '自由电子上限+3' }
    ]
  },
  {
    id: 'r12',
    name: '隔膜电解槽',
    icon: '🧪',
    description: '背包容量+2（负载更轻）',
    rarity: 'rare',
    color: 0x2dd4bf,
    unlock: { kind: 'depth', target: 5, label: '达成某个隐藏条件后解锁' },
    tiers: [
      { type: 'bag_capacity', value: 2, description: '背包容量+2' },
      { type: 'bag_capacity', value: 4, description: '背包容量+4' },
      { type: 'bag_capacity', value: 6, description: '背包容量+6' }
    ]
  }
];

/** 按稀有度加权随机选取遗物。 */
/**
 * 按稀有度加权随机选取遗物（每档内均匀）。
 * 用 Math.random 而非 Phaser 的随机：本文件被纯逻辑层与单测共用，
 * 依赖 Phaser 会让它在 node 环境下根本加载不了（Phaser 顶层就要读 window）。
 */
export function pickRelic(rarity?: RelicRarity): RelicDef {
  const pool = rarity ? relicDefs.filter((r) => r.rarity === rarity) : relicDefs;
  return pool[Math.floor(Math.random() * pool.length) % pool.length];
}

/** 获取遗物在指定等级的效果。 */
export function getRelicEffect(def: RelicDef, level: number): RelicEffect {
  return def.tiers[Math.min(level, 2)];
}

/** 获取稀有度颜色。 */
export function getRarityColor(rarity: RelicRarity): number {
  switch (rarity) {
    case 'common': return 0xffffff;
    case 'rare': return 0x3b82f6;
    case 'legendary': return 0xf59e0b;
  }
}

/** 获取稀有度标签。 */
export function getRarityLabel(rarity: RelicRarity): string {
  switch (rarity) {
    case 'common': return '普通';
    case 'rare': return '稀有';
    case 'legendary': return '传说';
  }
}

// ── 套装联动 ────────────────────────────────────────────────────────────────

/**
 * 套装：同时激活 `requires` 里全部遗物时触发 `effect`。
 *
 * 设计要点：联动必须**改变打法**而不是单纯堆数值，否则玩家只会当成白送的加成。
 * 所以四个套装各自对应一条明确的玩法路线：
 * - 原电池：同时走氧化与还原 → 双态都能打，不再被迫站队
 * - 催化循环：冷却 + 攻速 → 高频小输出的循环流
 * - 惰性护壁：护盾 + 反弹 → 挨打流，把承伤变成输出
 * - 临界反应堆：价电子 + 自由电子 → 大容量高爆发的资源流
 */
export interface RelicSet {
  id: string;
  name: string;
  desc: string;
  /** 需要同时激活的遗物 id（顺序无关） */
  requires: string[];
  effect: RelicEffect;
}

export const relicSets: RelicSet[] = [
  {
    id: 'set-galvanic',
    name: '原电池',
    desc: '氧化与还原同时强化：两种反应态都 +25% 伤害',
    requires: ['r06', 'r07'],
    effect: { type: 'dual_state_bonus', value: 25, description: '氧化/还原双态伤害各 +25%' }
  },
  {
    id: 'set-catalytic',
    name: '催化循环',
    desc: '攻速与冷却同时强化：冷却额外 -10%，攻速额外 +10%',
    requires: ['r02', 'r03'],
    effect: { type: 'cycle_bonus', value: 10, description: '冷却额外 -10%、攻速额外 +10%' }
  },
  {
    id: 'set-inert',
    name: '惰性护壁',
    desc: '护盾与反弹同时生效：反弹必定触发，且反弹伤害 +50%',
    requires: ['r04', 'r09'],
    effect: { type: 'wall_bonus', value: 50, description: '反弹必定触发且伤害 +50%' }
  },
  {
    id: 'set-critical',
    name: '临界反应堆',
    desc: '价电子与自由电子同时扩容：暴击率额外 +8%',
    requires: ['r10', 'r11'],
    effect: { type: 'reactor_bonus', value: 8, description: '暴击率额外 +8%' }
  }
];

/** 返回当前激活组合所触发的全部套装。 */
export function activeRelicSets(activeIds: readonly string[]): RelicSet[] {
  const owned = new Set(activeIds);
  return relicSets.filter((set) => set.requires.every((id) => owned.has(id)));
}

/** 按稀有度槽位上限裁剪激活列表；超出部分按原顺序丢弃。 */
export function clampActiveRelics(ids: readonly string[]): string[] {
  const used: Record<RelicRarity, number> = { common: 0, rare: 0, legendary: 0 };
  const out: string[] = [];
  for (const id of ids) {
    const def = relicDefs.find((r) => r.id === id);
    if (!def) continue;                       // 已删除/改名的 id 静默丢弃
    if (out.includes(id)) continue;           // 去重
    if (used[def.rarity] >= RELIC_SLOTS[def.rarity]) continue;
    used[def.rarity] += 1;
    out.push(id);
  }
  return out;
}

/** 某个稀有度的槽位占用情况。 */
export function relicSlotUsage(ids: readonly string[]): Record<RelicRarity, number> {
  const used: Record<RelicRarity, number> = { common: 0, rare: 0, legendary: 0 };
  for (const id of ids) {
    const def = relicDefs.find((r) => r.id === id);
    if (def) used[def.rarity] += 1;
  }
  return used;
}

/** 该稀有度是否还有空槽。 */
export function hasRelicSlot(ids: readonly string[], rarity: RelicRarity): boolean {
  return relicSlotUsage(ids)[rarity] < RELIC_SLOTS[rarity];
}