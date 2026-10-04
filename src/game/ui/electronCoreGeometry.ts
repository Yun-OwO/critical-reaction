/**
 * 电子轨道生命核心的纯几何计算（不依赖 Phaser，便于单测）。
 *
 * 独立于渲染层的原因：轨道点位置是「价电子剩余数量」的唯一视觉来源，
 * 一旦算错，玩家会读到错误的生命状态，因此必须可被单元测试覆盖。
 */

/** 轨道椭圆纵向压扁比：与 2:1 等距投影一致，保持 2.5D 观感。 */
export const ORBIT_TILT = 0.5;
/** 价电子显示上限（超过则折叠为数字，避免轨道过密不可读）。 */
export const MAX_VALENCE_DOTS = 12;
/** 自由电子显示上限。 */
export const MAX_FREE_DOTS = 6;
/** 护盾环满值（与 HUD 既有口径一致）。 */
export const SHIELD_FULL = 200;

export interface ElectronDot {
  /** 相对圆心的 x 偏移 */
  x: number;
  /** 相对圆心的 y 偏移 */
  y: number;
  /** 该点是否为存活电子 */
  active: boolean;
}

/**
 * 计算价电子在椭圆轨道上的位置。
 * 第 i 个电子的角度为 phase + 2πi/n；activeCount 之前的点算存活（实心发光），
 * 其余为空心剪影，让「缺了几颗电子」一眼可读。
 */
export function valenceElectronPositions(
  activeCount: number,
  totalCount: number,
  radius: number,
  phase: number
): ElectronDot[] {
  const n = Math.max(1, Math.min(Math.round(totalCount), MAX_VALENCE_DOTS));
  const active = Math.max(0, Math.min(Math.round(activeCount), n));
  const dots: ElectronDot[] = [];
  for (let i = 0; i < n; i += 1) {
    const angle = phase + (Math.PI * 2 * i) / n;
    dots.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * ORBIT_TILT,
      active: i < active
    });
  }
  return dots;
}

/** 计算自由电子（内层卫星）位置：反向自转，与价电子轨道形成对向运动。 */
export function freeElectronPositions(count: number, radius: number, phase: number): ElectronDot[] {
  const n = Math.max(0, Math.min(Math.round(count), MAX_FREE_DOTS));
  const dots: ElectronDot[] = [];
  const step = n > 0 ? (Math.PI * 2) / n : 0;
  for (let i = 0; i < n; i += 1) {
    const angle = phase - step * i + Math.PI * 0.5;
    dots.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * ORBIT_TILT,
      active: true
    });
  }
  return dots;
}

/** 护盾环比例（0-1），用于绘制外层金色弧。 */
export function shieldArcRatio(shieldHp: number, full = SHIELD_FULL): number {
  if (shieldHp <= 0) return 0;
  return Math.max(0, Math.min(1, shieldHp / full));
}