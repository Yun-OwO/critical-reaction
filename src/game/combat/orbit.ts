/** 敌方电子轨道容量标准值（填满 8 颗触发惰化击杀）。 */
export const ORBIT_CAPACITY = 8;

/** 单次攻击可消灭的敌人 HP 上限：不产生电子轨道。 */
export const SINGLE_HIT_MAX_HP = 12;

export interface OrbitState {
  /** 当前轨道电子数量。 */
  count: number;
  /** 轨道容量，固定为 8。 */
  capacity: number;
  /** 累计惰化次数。 */
  inertCount: number;
}

/**
 * 根据最大生命值创建轨道状态。
 * 单发生物（maxHp <= SINGLE_HIT_MAX_HP）不产生轨道，返回 null。
 * 电子数随HP增长但有上限，避免高层怪物被还原态秒杀。
 */
export function createOrbit(maxHp: number): OrbitState | null {
  if (maxHp <= SINGLE_HIT_MAX_HP) return null;
  // 低HP线性增长，高HP对数增长，上限5颗
  const raw = maxHp <= 90
    ? Math.round(maxHp / 22)
    : Math.round(Math.log2(maxHp / 30));
  return {
    count: Math.min(5, Math.max(1, raw)),
    capacity: ORBIT_CAPACITY,
    inertCount: 0
  };
}

export interface CaptureResult {
  count: number;
  /** 是否达到容量触发惰化（触发后轨道清空）。 */
  inertified: boolean;
}

/**
 * 还原交互：我方电子被敌方轨道捕获。
 * 数量 +1；达到容量时轨道破碎清空并触发惰化。
 */
export function captureElectron(orbit: OrbitState): CaptureResult {
  orbit.count = Math.min(orbit.capacity, orbit.count + 1);
  if (orbit.count >= orbit.capacity) {
    orbit.inertCount += 1;
    orbit.count = 0;
    return { count: 0, inertified: true };
  }
  return { count: orbit.count, inertified: false };
}

/**
 * 氧化交互：我方电子与敌方一颗轨道电子形成电子对并湮灭。
 * 每次有效击中抵消一颗；返回是否抵消成功（轨道为空时无法成对）。
 */
export function annihilatePair(orbit: OrbitState): boolean {
  if (orbit.count <= 0) return false;
  orbit.count -= 1;
  return true;
}

/** 电子对从轨道脱离后的存在时间（秒），到期自动破碎。 */
export const ELECTRON_PAIR_LIFETIME = 1.1;

/** 电子对互绕的视觉参数。 */
export const ELECTRON_PAIR_ANIM = {
  /** 互绕半径（像素）。 */
  radius: 7,
  /** 互绕角速度（弧度/秒）随机区间。 */
  spinMin: 2.2,
  spinMax: 4.2
};

/** 还原捕获（电子加入轨道）动画的可配置参数。 */
export const CAPTURE_ANIM = {
  /** 入场飞行时长（毫秒）。 */
  flyMs: 220,
  /** 入场飞行缓动。 */
  flyEase: 'Sine.inOut',
  /** 落位弹入时长（毫秒）。 */
  settleMs: 300,
  /** 落位缓动（带回弹）。 */
  settleEase: 'Back.out',
  /** 同行电子共鸣脉冲幅度（相对缩放）。 */
  resonateScale: 1.5,
  /** 共鸣脉冲时长（毫秒）。 */
  resonateMs: 220
};

/**
 * 攻击方向瞄准：碰撞只判定敌人本体，命中后由该函数在轨道电子中
 * 选出与攻击方向夹角最小的电子作为作用目标，返回其槽位索引。
 * angles 为各电子相对敌人本体的方位角（弧度），attackAngle 为攻击方向方位角。
 * 无可用电子时返回 -1。
 */
export function pickSlotToward(angles: number[], attackAngle: number): number {
  let bestIndex = -1;
  let bestDelta = Number.POSITIVE_INFINITY;
  angles.forEach((angle, index) => {
    const delta = Math.abs(Math.atan2(Math.sin(angle - attackAngle), Math.cos(angle - attackAngle)));
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  });
  return bestIndex;
}

/** 玩家电子轨道的战斗状态：待机 / 我方攻击放电 / 特殊攻击充能爆发 / 受击 / 失去价电子。 */
export type OrbitVisualState = 'idle' | 'attack' | 'special' | 'hurt' | 'lost';

/** 单个状态下的电子轨道视觉资源配置。 */
export interface OrbitVisualParams {
  /** 轨道线颜色。 */
  color: number;
  /** 轨道线透明度（强度）。 */
  lineAlpha: number;
  /** 电子自转速度倍率。 */
  spinMultiplier: number;
  /** 电子缩放倍率。 */
  electronScale: number;
  /** 电子亮度倍率（叠乘在 EHP 亮度之上）。 */
  electronAlpha: number;
  /** 轨道抖动幅度（像素）。 */
  jitter: number;
  /** 是否频闪。 */
  flicker: boolean;
}

const ORBIT_VISUALS: Record<OrbitVisualState, OrbitVisualParams> = {
  idle: { color: 0x67e8f9, lineAlpha: 0.5, spinMultiplier: 1, electronScale: 1, electronAlpha: 1, jitter: 0, flicker: false },
  attack: { color: 0xa5f3fc, lineAlpha: 0.95, spinMultiplier: 2.4, electronScale: 1.5, electronAlpha: 1, jitter: 0, flicker: false },
  special: { color: 0xffffff, lineAlpha: 1, spinMultiplier: 3.6, electronScale: 1.9, electronAlpha: 1, jitter: 3, flicker: true },
  hurt: { color: 0xff5c7a, lineAlpha: 1, spinMultiplier: 1.6, electronScale: 1.25, electronAlpha: 1, jitter: 5, flicker: true },
  lost: { color: 0xff5c7a, lineAlpha: 1, spinMultiplier: 0.6, electronScale: 1.8, electronAlpha: 1, jitter: 9, flicker: true }
};

/** 取指定战斗状态的电子轨道视觉参数。 */
export function orbitVisualParams(state: OrbitVisualState): OrbitVisualParams {
  return ORBIT_VISUALS[state];
}
