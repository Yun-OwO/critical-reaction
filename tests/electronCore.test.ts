import { describe, expect, it } from 'vitest';
import {
  MAX_FREE_DOTS,
  MAX_VALENCE_DOTS,
  ORBIT_TILT,
  SHIELD_FULL,
  freeElectronPositions,
  shieldArcRatio,
  valenceElectronPositions
} from '../src/game/ui/electronCoreGeometry';

describe('电子轨道生命核心几何（§14.3）', () => {
  it('价电子点数等于上限，存活数等于当前价电子数', () => {
    const dots = valenceElectronPositions(3, 6, 100, 0);
    expect(dots).toHaveLength(6);
    expect(dots.filter((d) => d.active)).toHaveLength(3);
  });

  it('存活电子恒为序列前 N 个（缺失者排在后，视觉可数）', () => {
    const dots = valenceElectronPositions(2, 5, 100, 0);
    expect(dots.map((d) => d.active)).toEqual([true, true, false, false, false]);
  });

  it('价电子数超过上限时被夹取，避免轨道过密不可读', () => {
    const dots = valenceElectronPositions(40, 40, 100, 0);
    expect(dots).toHaveLength(MAX_VALENCE_DOTS);
    expect(dots.every((d) => d.active)).toBe(true);
  });

  it('价电子数下限至少 1 且存活数不小于 0', () => {
    expect(valenceElectronPositions(0, 0, 100, 0)).toHaveLength(1);
    expect(valenceElectronPositions(-3, 4, 100, 0).filter((d) => d.active)).toHaveLength(0);
    expect(valenceElectronPositions(9, 4, 100, 0).filter((d) => d.active)).toHaveLength(4);
  });

  it('轨道为 2:1 等距椭圆（纵向压扁 ORBIT_TILT）', () => {
    const dots = valenceElectronPositions(4, 4, 100, 0);
    for (const dot of dots) {
      const radius = Math.hypot(dot.x, dot.y / ORBIT_TILT);
      expect(radius).toBeCloseTo(100, 6);
    }
    expect(ORBIT_TILT).toBe(0.5);
  });

  it('相位旋转使所有点整体转动且保持等距分布', () => {
    const a = valenceElectronPositions(4, 4, 100, 0);
    const b = valenceElectronPositions(4, 4, 100, Math.PI / 2);
    expect(a[0].x).not.toBeCloseTo(b[0].x, 6);
    // 相邻点夹角恒为 2π/n
    const n = 4;
    for (let i = 0; i < n; i += 1) {
      const p = a[i];
      const q = a[(i + 1) % n];
      const angle = Math.acos(
        Math.max(-1, Math.min(1, (p.x * q.x + (p.y / ORBIT_TILT) * (q.y / ORBIT_TILT)) / (100 * 100)))
      );
      expect(angle).toBeCloseTo((Math.PI * 2) / n, 6);
    }
  });

  it('相同输入完全确定（可复现，不引入随机）', () => {
    const a = valenceElectronPositions(3, 7, 80, 1.23);
    const b = valenceElectronPositions(3, 7, 80, 1.23);
    expect(a).toEqual(b);
  });

  it('自由电子卫星数量取当前值并受上限约束', () => {
    expect(freeElectronPositions(0, 40, 0)).toHaveLength(0);
    expect(freeElectronPositions(3, 40, 0)).toHaveLength(3);
    expect(freeElectronPositions(20, 40, 0)).toHaveLength(MAX_FREE_DOTS);
    expect(freeElectronPositions(2, 40, 0).every((d) => d.active)).toBe(true);
  });

  it('自由电子与价电子反向自转（相位符号相反）', () => {
    const forward = freeElectronPositions(1, 40, 0.5)[0];
    const backward = freeElectronPositions(1, 40, -0.5)[0];
    expect(forward.x).not.toBeCloseTo(backward.x, 6);
  });

  it('护盾弧比例夹取在 0-1 之间', () => {
    expect(shieldArcRatio(0)).toBe(0);
    expect(shieldArcRatio(-10)).toBe(0);
    expect(shieldArcRatio(SHIELD_FULL / 2)).toBeCloseTo(0.5, 6);
    expect(shieldArcRatio(SHIELD_FULL * 5)).toBe(1);
  });
});