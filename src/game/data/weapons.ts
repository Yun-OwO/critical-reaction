/**
 * 武器系统（设计文档 §7）
 *
 * 每把武器 3 级：每级 +5% 伤害、+3% 攻速；满级（Lv.3）解锁「形态」。
 * 形态不是皮肤 —— 每个形态都更换玩法倾向（氧化/还原倾向、范围、放热、自损换输出），
 * 让同一把武器在不同形态下是不同打法。
 */

export type WeaponId = 'platinum-knife' | 'reaction-cannon';

/** 形态对玩法的修正项（全部可选，未填即为 1）。 */
export interface WeaponFormData {
  id: string;
  name: string;
  desc: string;
  /** 全局伤害倍率 */
  damageMult?: number;
  /** 攻击间隔倍率（越小越快） */
  cooldownMult?: number;
  /** 射程 / 刀身长度倍率 */
  rangeMult?: number;
  /** 爆炸与范围倍率 */
  aoeMult?: number;
  /** 仅氧化态生效的伤害倍率 */
  oxidizeMult?: number;
  /** 仅还原态生效的伤害倍率 */
  reduceMult?: number;
  /** 放热倍率（攻击造成的升温） */
  heatMult?: number;
  /** 每秒自损（HP） */
  selfDamagePerSec?: number;
  /** 道尔顿式：伤害随负载提升（每 100% 负载增加的比例） */
  loadScale?: number;
}

export interface WeaponData {
  id: WeaponId;
  name: string;
  type: 'melee' | 'ranged';
  baseDamage: number;
  cooldown: number;
  range: number;
  description: string;
  /** 满级解锁的形态（3 选 1） */
  forms: WeaponFormData[];
}

export const weapons: WeaponData[] = [
  {
    id: 'platinum-knife',
    name: '铂电极光剑',
    type: 'melee',
    baseDamage: 22,
    cooldown: 0.22,
    range: 400,
    description: '近战激光光剑，横扫切割',
    forms: [
      {
        id: 'mendeleev', name: '门捷列夫', desc: '预测反应：氧化态伤害 +25%，射程 +15%',
        oxidizeMult: 1.25, rangeMult: 1.15
      },
      {
        id: 'curie', name: '居里', desc: '攻击附带辐射：伤害 +30%，但每秒自损 3 HP',
        damageMult: 1.3, selfDamagePerSec: 3
      },
      {
        id: 'lavoisier', name: '拉瓦锡', desc: '氧化 +35%，还原 -20%',
        oxidizeMult: 1.35, reduceMult: 0.8
      },
      {
        id: 'dalton', name: '道尔顿', desc: '原子量：伤害随负载提升（每 100% 负载 +60%）',
        loadScale: 0.6
      }
    ]
  },
  {
    id: 'reaction-cannon',
    name: '反应炮',
    type: 'ranged',
    baseDamage: 18,
    cooldown: 0.18,
    range: 600,
    description: '快速放热弹，放热',
    forms: [
      {
        id: 'bunsen', name: '本生灯', desc: '放热 +50%：伤害 +20%，但升温也 +50%',
        damageMult: 1.2, heatMult: 1.5
      },
      {
        id: 'oxyacetylene', name: '氧炔', desc: '爆炸范围 +30%，射程 +10%',
        aoeMult: 1.3, rangeMult: 1.1
      },
      {
        id: 'nucleide', name: '核素', desc: '核反应伤害 +60%，但每秒自损 4 HP',
        damageMult: 1.6, selfDamagePerSec: 4
      }
    ]
  }
];

export function getWeapon(id: string): WeaponData {
  return weapons.find((w) => w.id === id) ?? weapons[0];
}

/** 武器最高等级（1 起始，满级 3）。 */
export const MAX_WEAPON_LEVEL = 3;
/** 每级伤害 / 攻速收益（§7.3）。 */
export const WEAPON_LEVEL_DAMAGE_BONUS = 0.05;
export const WEAPON_LEVEL_COOLDOWN_BONUS = 0.03;
/** 升级消耗（样本）：Lv.1→2 / Lv.2→3。 */
export const WEAPON_UPGRADE_COSTS = [8, 20] as const;

/** 指定等级的升级消耗；已满级返回 null。 */
export function weaponUpgradeCost(level: number): number | null {
  if (level >= MAX_WEAPON_LEVEL) return null;
  return WEAPON_UPGRADE_COSTS[Math.max(0, Math.min(WEAPON_UPGRADE_COSTS.length - 1, level - 1))];
}

/** 等级带来的伤害倍率与攻速倍率。 */
export function weaponLevelBonus(level: number): { damageMult: number; cooldownMult: number } {
  const lv = Math.max(1, Math.min(MAX_WEAPON_LEVEL, Math.round(level)));
  const steps = lv - 1;
  return {
    damageMult: 1 + steps * WEAPON_LEVEL_DAMAGE_BONUS,
    cooldownMult: 1 - steps * WEAPON_LEVEL_COOLDOWN_BONUS
  };
}

/** 满级才解锁形态（§7.3）；未满级或形态不存在时返回 null。 */
export function unlockedForm(weaponId: string, formId: string | null, level: number): WeaponFormData | null {
  if (level < MAX_WEAPON_LEVEL || !formId) return null;
  return getWeapon(weaponId).forms.find((f) => f.id === formId) ?? null;
}

/**
 * 汇总「等级 + 形态 + 负载」对武器的最终修正。
 * loadRatio 只在形态带 loadScale 时参与（道尔顿：越重打得越狠）。
 */
export function resolveWeaponModifiers(
  weaponId: string,
  level: number,
  formId: string | null,
  loadRatio = 0
): { damageMult: number; cooldownMult: number; rangeMult: number; aoeMult: number; heatMult: number; selfDamagePerSec: number; oxidizeMult: number; reduceMult: number } {
  const levelBonus = weaponLevelBonus(level);
  const form = unlockedForm(weaponId, formId, level);
  const loadBonus = form?.loadScale ? 1 + form.loadScale * Math.max(0, loadRatio) : 1;
  return {
    damageMult: levelBonus.damageMult * (form?.damageMult ?? 1) * loadBonus,
    cooldownMult: levelBonus.cooldownMult * (form?.cooldownMult ?? 1),
    rangeMult: form?.rangeMult ?? 1,
    aoeMult: form?.aoeMult ?? 1,
    heatMult: form?.heatMult ?? 1,
    selfDamagePerSec: form?.selfDamagePerSec ?? 0,
    oxidizeMult: form?.oxidizeMult ?? 1,
    reduceMult: form?.reduceMult ?? 1
  };
}