/**
 * 遗物系统数据结构
 *
 * 10个遗物，每个3个升级等级。
 * 遗物通过达成各自的探险条件逐步解锁（详见 `unlock`）。
 * 遗物只能激活一个：已解锁的遗物陈列在展示柜中，激活的遗物浮空区分。
 */

import Phaser from 'phaser';

export type RelicRarity = 'common' | 'rare' | 'legendary';

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
  }
];

/** 按稀有度加权随机选取遗物。 */
export function pickRelic(rarity?: RelicRarity): RelicDef {
  const pool = rarity ? relicDefs.filter((r) => r.rarity === rarity) : relicDefs;
  return pool[Phaser.Math.Between(0, pool.length - 1)];
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