/**
 * Hades 式祝福系统 — 化学元素主题（电子轨道核心）
 *
 * 四大元素「学派」：
 *   氢 (H)  — 红/电子夺取
 *   氧 (O)  — 青蓝/持续电子效果
 *   碳 (C)  — 金黄/电子防御/恢复
 *   催化剂   — 紫/速度/功能性
 *
 * 四个装备槽位：
 *   attack  — 攻击祝福
 *   special — 特殊祝福
 *   dash    — 冲刺祝福
 *   passive — 被动祝福
 *
 * 稀有度：普通 → 稀有 → 史诗 → 神话
 */

export type BoonSlot = 'attack' | 'special' | 'dash' | 'passive';
export type BoonRarity = 'common' | 'rare' | 'epic' | 'mythic';
export type ElementSchool = 'H' | 'O' | 'C' | 'cat';

export interface BoonDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  slot: BoonSlot;
  school: ElementSchool;
  rarity: BoonRarity;
  rarityScale: Record<BoonRarity, number>;
}

/** 学派配色 */
export const SCHOOL_COLORS: Record<ElementSchool, { primary: number; light: string; dark: string; glow: string }> = {
  H:   { primary: 0xff5c7a, light: '#ff5c7a', dark: '#7f2e3d', glow: '#ff5c7a44' },
  O:   { primary: 0x67e8f9, light: '#67e8f9', dark: '#1e5f6e', glow: '#67e8f944' },
  C:   { primary: 0xfbbf24, light: '#fbbf24', dark: '#6b4f0a', glow: '#fbbf2444' },
  cat: { primary: 0xa78bfa, light: '#a78bfa', dark: '#4c3a8a', glow: '#a78bfa44' }
};

export const SCHOOL_NAMES: Record<ElementSchool, string> = {
  H: '氢·爆裂', O: '氧·氧化', C: '碳·结构', cat: '催化·加速'
};

export const SCHOOL_SYMBOLS: Record<ElementSchool, string> = {
  H: '⚛', O: '◎', C: '⬡', cat: '⚡'
};

export const SLOT_ICONS: Record<BoonSlot, string> = {
  attack: '🗡', special: '🔮', dash: '💨', passive: '🛡'
};

export const SLOT_NAMES: Record<BoonSlot, string> = {
  attack: '攻击', special: '特殊', dash: '冲刺', passive: '被动'
};

export const RARITY_LABELS: Record<BoonRarity, string> = {
  common: '普通', rare: '稀有', epic: '史诗', mythic: '神话'
};

export const RARITY_COLORS: Record<BoonRarity, string> = {
  common: '#e2e8f0', rare: '#67e8f9', epic: '#a78bfa', mythic: '#fbbf24'
};

/** 所有祝福池 */
export const BOON_POOL: BoonDef[] = [
  // ===== 氢·爆裂 (H) — 直接电子夺取 =====
  {
    id: 'h-atk-overload', name: '过载打击', desc: '氧化攻击额外夺取 {n} 颗电子',
    icon: '💥', slot: 'attack', school: 'H', rarity: 'common',
    rarityScale: { common: 1, rare: 1, epic: 2, mythic: 2 }
  },
  {
    id: 'h-atk-chain', name: '链式反应', desc: '氧化命中后弹射夺取最近敌人 {n} 颗电子',
    icon: '⚡', slot: 'attack', school: 'H', rarity: 'rare',
    rarityScale: { common: 0, rare: 1, epic: 1, mythic: 2 }
  },
  {
    id: 'h-sp-fission', name: '裂变冲击', desc: '特殊攻击命中时，对周围敌人各夺取 {n} 颗电子',
    icon: '☢', slot: 'special', school: 'H', rarity: 'common',
    rarityScale: { common: 1, rare: 1, epic: 2, mythic: 2 }
  },
  {
    id: 'h-sp-nuke', name: '核聚变', desc: '特殊攻击夺取电子数 ×{n}',
    icon: '🔥', slot: 'special', school: 'H', rarity: 'rare',
    rarityScale: { common: 0, rare: 2, epic: 3, mythic: 3 }
  },
  {
    id: 'h-dash-detonate', name: '引爆冲刺', desc: '冲刺结束爆炸，夺取范围内敌人各 {n} 颗电子',
    icon: '💣', slot: 'dash', school: 'H', rarity: 'common',
    rarityScale: { common: 1, rare: 1, epic: 2, mythic: 2 }
  },
  {
    id: 'h-pass-glass', name: '玻璃大炮', desc: '氧化夺取 +{n} 颗电子，但受伤额外失去1个价电子',
    icon: '💎', slot: 'passive', school: 'H', rarity: 'epic',
    rarityScale: { common: 0, rare: 0, epic: 2, mythic: 3 }
  },

  // ===== 氧·氧化 (O) — 持续/范围电子效果 =====
  {
    id: 'o-atk-ignite', name: '点燃', desc: '攻击附加燃烧，{n} 秒内每秒夺取1颗电子',
    icon: '🔥', slot: 'attack', school: 'O', rarity: 'common',
    rarityScale: { common: 3, rare: 3, epic: 4, mythic: 5 }
  },
  {
    id: 'o-atk-acid', name: '酸蚀', desc: '攻击降低敌人50%移速2秒，{n}秒内每秒额外夺取1颗电子',
    icon: '🧪', slot: 'attack', school: 'O', rarity: 'rare',
    rarityScale: { common: 0, rare: 1, epic: 1, mythic: 2 }
  },
  {
    id: 'o-sp-corrode', name: '腐蚀扩散', desc: '特殊攻击留下酸池，范围内每秒夺取 {n} 颗电子',
    icon: '💧', slot: 'special', school: 'O', rarity: 'common',
    rarityScale: { common: 1, rare: 1, epic: 2, mythic: 2 }
  },
  {
    id: 'o-sp-plasma', name: '等离子体', desc: '特殊攻击范围 +50%，命中额外夺取 {n} 颗电子',
    icon: '🌀', slot: 'special', school: 'O', rarity: 'rare',
    rarityScale: { common: 0, rare: 1, epic: 1, mythic: 2 }
  },
  {
    id: 'o-dash-mist', name: '氧化雾', desc: '冲刺留下毒雾，范围内每秒夺取 {n} 颗电子',
    icon: '🌫', slot: 'dash', school: 'O', rarity: 'common',
    rarityScale: { common: 1, rare: 1, epic: 1, mythic: 2 }
  },
  {
    id: 'o-pass-temp', name: '散热涂层', desc: '温度上升 -{n}%，温度每低10度氧化夺取 +1',
    icon: '❄', slot: 'passive', school: 'O', rarity: 'rare',
    rarityScale: { common: 0, rare: 30, epic: 40, mythic: 50 }
  },

  // ===== 碳·结构 (C) — 电子防御/恢复 =====
  {
    id: 'c-atk-shield', name: '碳键护甲', desc: '攻击命中生成 {v} 点护盾（先于EHP吸收伤害）',
    icon: '🛡', slot: 'attack', school: 'C', rarity: 'common',
    rarityScale: { common: 1, rare: 1, epic: 1, mythic: 1 }
  },
  {
    id: 'c-atk-lattice', name: '晶格冲击', desc: '攻击20%概率眩晕1秒，眩晕期间额外夺取 {n} 颗电子',
    icon: '🔷', slot: 'attack', school: 'C', rarity: 'rare',
    rarityScale: { common: 0, rare: 2, epic: 3, mythic: 3 }
  },
  {
    id: 'c-sp-wall', name: '分子壁垒', desc: '特殊攻击生成护盾墙，阻挡弹幕 {n} 秒',
    icon: '🧱', slot: 'special', school: 'C', rarity: 'common',
    rarityScale: { common: 3, rare: 3, epic: 4, mythic: 5 }
  },
  {
    id: 'c-sp-fortify', name: '聚合加固', desc: '永久 +{n} 个价电子上限（+{v} 最大HP）',
    icon: '❤', slot: 'special', school: 'C', rarity: 'rare',
    rarityScale: { common: 0, rare: 1, epic: 2, mythic: 2 }
  },
  {
    id: 'c-dash-barrier', name: '碳纤冲刺', desc: '冲刺时获得 {n} 点护盾',
    icon: '🛡', slot: 'dash', school: 'C', rarity: 'common',
    rarityScale: { common: 5, rare: 9, epic: 14, mythic: 20 }
  },
  {
    id: 'c-pass-heal', name: '自修复', desc: '每清完一个房间恢复 {n} HP',
    icon: '💚', slot: 'passive', school: 'C', rarity: 'epic',
    rarityScale: { common: 0, rare: 0, epic: 8, mythic: 15 }
  },

  // ===== 催化剂 (cat) — 速度/功能性 =====
  {
    id: 'cat-atk-speed', name: '催化加速', desc: '攻击冷却 -{n}%',
    icon: '⚡', slot: 'attack', school: 'cat', rarity: 'common',
    rarityScale: { common: 25, rare: 25, epic: 30, mythic: 35 }
  },
  {
    id: 'cat-atk-crit', name: '活性位点', desc: '攻击 {n}% 概率暴击，夺取2颗电子（而非1颗）',
    icon: '✦', slot: 'attack', school: 'cat', rarity: 'rare',
    rarityScale: { common: 0, rare: 15, epic: 20, mythic: 25 }
  },
  {
    id: 'cat-sp-homing', name: '分子间力', desc: '特殊攻击自动追踪最近敌人',
    icon: '🧲', slot: 'special', school: 'cat', rarity: 'common',
    rarityScale: { common: 1, rare: 1, epic: 1, mythic: 1 }
  },
  {
    id: 'cat-sp-multi', name: '多相催化', desc: '特殊攻击额外发射 {n} 发弹体',
    icon: '✦', slot: 'special', school: 'cat', rarity: 'rare',
    rarityScale: { common: 0, rare: 1, epic: 2, mythic: 3 }
  },
  {
    id: 'cat-dash-echo', name: '共振冲刺', desc: '冲刺后下一次攻击夺取电子 ×{n}',
    icon: '🔊', slot: 'dash', school: 'cat', rarity: 'common',
    rarityScale: { common: 3, rare: 3, epic: 4, mythic: 5 }
  },
  {
    id: 'cat-pass-movespeed', name: '降低活化能', desc: '移动速度 +{n}%',
    icon: '🏃', slot: 'passive', school: 'cat', rarity: 'rare',
    rarityScale: { common: 0, rare: 20, epic: 25, mythic: 30 }
  }
];

/** 根据稀有度替换描述中的占位符 */
export function formatBoonDesc(boon: BoonDef): string {
  const v = boon.rarityScale[boon.rarity];
  let text = boon.desc
    .replace(/\{n\}/g, String(Math.round(v)))
    .replace(/\{pct\}/g, String(Math.round(v)));
  // 碳系：显示对应的数值
  if (boon.id === 'c-atk-shield') {
    // 碳键护甲实际效果：每次命中生成 v*10 点护盾
    text = text.replace(/\{v\}/g, String(v * 10));
  } else if (boon.id === 'c-sp-fortify') {
    text = text.replace(/\{v\}/g, String(v * 80));
  }
  return text;
}

/** 按 id 查询祝福定义（用于运行时读取生效数值）。 */
export function getBoonDef(id: string): BoonDef | undefined {
  return BOON_POOL.find((b) => b.id === id);
}

/**
 * 每局随机禁用 N 个不同祝福 id（卫戍协议「每局禁用盟约」简化版）：
 * 强制每局换 build、防背版。Fisher-Yates 洗牌后取前 N。
 */
export function sampleDisabledBoons(pool: BoonDef[], count: number, rng: () => number = Math.random): string[] {
  const ids = Array.from(new Set(pool.map((b) => b.id)));
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, Math.min(count, ids.length));
}

/**
 * 从祝福池中随机选取 n 个不重复的祝福，保证槽位/学派多样性。
 * 优先覆盖不同槽位，其次不同学派。
 */
export function pickBoons(
  count: number,
  rng: () => number = Math.random,
  exclude: ReadonlySet<string> = new Set()
): BoonDef[] {
  const pool = BOON_POOL.filter((b) => !exclude.has(b.id));
  const result: BoonDef[] = [];
  const usedSlots = new Set<BoonSlot>();
  const usedSchools = new Set<ElementSchool>();

  // 第一轮：优先选不同槽位
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const unbuilt = pool.filter((b) => !usedSlots.has(b.slot));
    const candidates = unbuilt.length > 0 ? unbuilt : pool;
    const idx = Math.floor(rng() * candidates.length);
    const picked = candidates[idx];
    result.push(picked);
    usedSlots.add(picked.slot);
    usedSchools.add(picked.school);
    pool.splice(pool.indexOf(picked), 1);
  }
  return result;
}
