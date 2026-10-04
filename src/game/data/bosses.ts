/**
 * Boss 数据定义
 *
 * 5 个 Boss，每个有独特的攻击模式和阶段转换。
 * 层 0: 滴定巨像 (酸碱形态切换)
 * 层 1: 电解领主 (电弧/双元素弹)
 * 层 2: 链式反应母体 (分裂/链式爆炸)
 * 最终: 氧化之主 (燃烧/温度熔毁)
 */

export type BossId = 'titration' | 'electrolysis' | 'chain' | 'oxidation';

export interface BossPhaseConfig {
  phase: 1 | 2 | 3;
  speed: number;
  slamCooldown: number;
  shotCooldown: number;
  aoeCooldown: number;
  shotCount: number;
  shotSpread: number;
  transitionElectronThreshold?: number;
}

export interface BossConfig {
  id: BossId;
  name: string;
  color: number;
  sprite: string;
  orbitCounts: number[];
  phases: BossPhaseConfig[];
}

export const BOSS_CONFIGS: Record<string, BossConfig> = {
  0: {
    id: 'titration',
    name: '滴定巨像',
    color: 0x9d4edd,
    sprite: 'boss-titration',
    orbitCounts: [2, 3, 3, 4, 4, 5, 5, 6],
    phases: [
      { phase: 1, speed: 42, slamCooldown: 3.5, shotCooldown: 2.2, aoeCooldown: 8, shotCount: 1, shotSpread: 0, transitionElectronThreshold: 20 },
      { phase: 2, speed: 78, slamCooldown: 2.6, shotCooldown: 1.5, aoeCooldown: 5.5, shotCount: 3, shotSpread: 0.28 },
      { phase: 3, speed: 50, slamCooldown: 4, shotCooldown: 2, aoeCooldown: 3, shotCount: 5, shotSpread: 0.15 }
    ]
  },
  1: {
    id: 'electrolysis',
    name: '电解领主',
    color: 0x67e8f9,
    sprite: 'boss-electrolysis',
    orbitCounts: [3, 3, 4, 4, 5, 5, 6, 6],
    phases: [
      { phase: 1, speed: 50, slamCooldown: 3, shotCooldown: 1.8, aoeCooldown: 7, shotCount: 2, shotSpread: 0.4, transitionElectronThreshold: 22 },
      { phase: 2, speed: 70, slamCooldown: 2.2, shotCooldown: 1.2, aoeCooldown: 5, shotCount: 4, shotSpread: 0.3 },
      { phase: 3, speed: 90, slamCooldown: 1.8, shotCooldown: 1, aoeCooldown: 4, shotCount: 6, shotSpread: 0.2 }
    ]
  },
  2: {
    id: 'chain',
    name: '链式反应母体',
    color: 0xfde047,
    sprite: 'boss-chain',
    orbitCounts: [2, 2, 3, 3, 4, 4, 5, 5],
    phases: [
      { phase: 1, speed: 38, slamCooldown: 4, shotCooldown: 2.5, aoeCooldown: 9, shotCount: 1, shotSpread: 0, transitionElectronThreshold: 18 },
      { phase: 2, speed: 55, slamCooldown: 3, shotCooldown: 1.8, aoeCooldown: 6, shotCount: 2, shotSpread: 0.5 },
      { phase: 3, speed: 70, slamCooldown: 2, shotCooldown: 1.2, aoeCooldown: 4, shotCount: 3, shotSpread: 0.35 }
    ]
  },
  final: {
    id: 'oxidation',
    name: '氧化之主',
    color: 0xff3b30,
    sprite: 'boss-oxidation',
    orbitCounts: [3, 4, 4, 5, 5, 6, 6, 7],
    phases: [
      { phase: 1, speed: 55, slamCooldown: 3, shotCooldown: 2, aoeCooldown: 7, shotCount: 2, shotSpread: 0.3, transitionElectronThreshold: 25 },
      { phase: 2, speed: 80, slamCooldown: 2, shotCooldown: 1.3, aoeCooldown: 5, shotCount: 4, shotSpread: 0.25 },
      { phase: 3, speed: 100, slamCooldown: 1.5, shotCooldown: 0.8, aoeCooldown: 3.5, shotCount: 6, shotSpread: 0.18 }
    ]
  }
};

/** 根据层获取 Boss 配置。 */
export function getBossConfigForLayer(layer: number, isFinal: boolean): BossConfig {
  if (isFinal) return BOSS_CONFIGS['final'];
  return BOSS_CONFIGS[String(layer)] ?? BOSS_CONFIGS['0'];
}
