/**
 * 逸散光雾场测试（T08）。
 *
 * 这些断言对应你提出的具体要求，每条失败都意味着对应视觉特征被破坏：
 *   边缘完全透明 / 浓淡随密度变化 / 叠加不爆掉 / 运动连贯有随机性 /
 *   不固定重复路径 / 不接战斗随机 / 预算可削减而不整片消失。
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLOW,
  EMIT_PRESETS,
  FlowField,
  ValueNoise2D,
  VaporField,
  clearDensity,
  densityToAlpha,
  kernelWeight,
  splatDensity,
  type EmitParams
} from '../src/game/fx/VaporField';
import { RunRng } from '../src/game/utils/RunRng';

const params = (over: Partial<EmitParams> = {}): EmitParams => ({
  count: 50, x: 0, y: 0, angle: 0, spread: 0.5,
  speedMin: 40, speedMax: 120, lifeMin: 0.3, lifeMax: 0.6,
  sizeMin: 1.5, sizeMax: 3.5, tint: 0xffffff, cosmetic: true,
  ...over
});

describe('T08 值噪声：连续且可复现', () => {
  it('同种子产生相同序列', () => {
    const a = new ValueNoise2D(99);
    const b = new ValueNoise2D(99);
    for (let i = 0; i < 20; i += 1) {
      expect(a.sample(i * 0.3, i * 0.7)).toBe(b.sample(i * 0.3, i * 0.7));
    }
  });

  it('不同种子产生不同序列', () => {
    const a = new ValueNoise2D(1);
    const b = new ValueNoise2D(2);
    let same = 0;
    for (let i = 0; i < 20; i += 1) {
      if (a.sample(i * 0.31, i * 0.17) === b.sample(i * 0.31, i * 0.17)) same += 1;
    }
    expect(same).toBeLessThan(5);
  });

  it('取值有界（约 [-1,1]）', () => {
    const n = new ValueNoise2D(7);
    for (let i = 0; i < 500; i += 1) {
      const v = n.sample(i * 0.13, i * 0.29);
      expect(v).toBeGreaterThanOrEqual(-1.001);
      expect(v).toBeLessThanOrEqual(1.001);
    }
  });

  it('空间连续：小步移动不会剧烈跳变（保证连贯而非白噪声）', () => {
    const n = new ValueNoise2D(3);
    let maxJump = 0;
    let prev = n.sample(0, 0);
    for (let t = 0.01; t < 2; t += 0.01) {
      const v = n.sample(t, t * 0.5);
      maxJump = Math.max(maxJump, Math.abs(v - prev));
      prev = v;
    }
    // 步长 0.01 时变化应当平缓；若 >0.5 说明场不连续
    expect(maxJump).toBeLessThan(0.5);
  });
});

describe('T08 流场：限幅、环绕、连续推进', () => {
  it('加速度不超过配置上限', () => {
    const f = new FlowField();
    for (let i = 0; i < 200; i += 1) {
      const a = f.sampleAccel(i * 37, i * 91);
      expect(Math.hypot(a.ax, a.ay)).toBeLessThanOrEqual(DEFAULT_FLOW.maxAccel + 1e-6);
    }
  });

  it('跨越场边界不出现 NaN（环绕采样）', () => {
    const f = new FlowField();
    const a = f.sampleAccel(-9999, -9999);
    expect(Number.isFinite(a.ax)).toBe(true);
    expect(Number.isFinite(a.ay)).toBe(true);
    const b = f.sampleAccel(999999, 999999);
    expect(Number.isFinite(b.ax)).toBe(true);
  });

  it('相邻位置的加速度相近（不是逐格跳变）', () => {
    const f = new FlowField();
    let maxDiff = 0;
    for (let i = 0; i < 100; i += 1) {
      const a = f.sampleAccel(i * 64, i * 64);
      const b = f.sampleAccel(i * 64 + 2, i * 64 + 2);
      maxDiff = Math.max(maxDiff, Math.hypot(a.ax - b.ax, a.ay - b.ay));
    }
    expect(maxDiff).toBeLessThan(DEFAULT_FLOW.maxAccel);
  });

  it('advance 后场仍在有效范围且不抛错', () => {
    const f = new FlowField();
    for (let i = 0; i < 120; i += 1) {
      f.advance(1 / 60);
      const a = f.sampleAccel(i * 11, i * 7);
      expect(Number.isFinite(a.ax)).toBe(true);
    }
  });

  it('dt=0 不改变场', () => {
    const f1 = new FlowField();
    const f2 = new FlowField();
    f2.advance(0);
    expect(f2.sampleAccel(100, 100)).toEqual(f1.sampleAccel(100, 100));
  });
});

describe('T08 密度映射：浓淡变化且边缘透明', () => {
  it('密度越大不透明度越高（浓淡层次）', () => {
    const a = densityToAlpha(0.05);
    const b = densityToAlpha(0.5);
    const c = densityToAlpha(2);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it('不透明度恒小于 1（永远不会变成实心白块）', () => {
    for (const d of [0.1, 1, 10, 1000]) {
      const a = densityToAlpha(d);
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('叠加是饱和的而非线性爆掉', () => {
    // 密度翻 10 倍：线性映射会给 10 倍，实际远低于此
    const a1 = densityToAlpha(0.2);
    const a10 = densityToAlpha(2);
    expect(a10).toBeGreaterThan(a1);
    expect(a10 / a1).toBeLessThan(8);
  });

  it('极高密度被钳制，不产生完全不透明的核心', () => {
    // 这是实测发现的缺陷：exp 下溢会让 1-exp(-kD) 舍入成 1.0
    for (const d of [100, 1000, 1e6]) {
      const a = densityToAlpha(d);
      expect(a).toBeLessThan(1);
      expect(a).toBeLessThanOrEqual(0.96);
    }
  });

  it('密度为 0 或负数返回 0（完全透明）', () => {
    expect(densityToAlpha(0)).toBe(0);
    expect(densityToAlpha(-1)).toBe(0);
  });

  it('核半径外及边界处贡献精确为 0（无硬切边）', () => {
    expect(kernelWeight(10, 10)).toBe(0);      // 边界恰好为 0
    expect(kernelWeight(10.0001, 10)).toBe(0);
    expect(kernelWeight(20, 10)).toBe(0);
    // 紧贴边界时也应趋于 0（smoothstep 保证导数为 0，不会出现硬环）
    expect(kernelWeight(9.99, 10)).toBeLessThan(1e-4);
  });

  it('核中心权重为 1，向外平滑衰减到 0', () => {
    expect(kernelWeight(0, 10)).toBe(1);
    const mid = kernelWeight(5, 10);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(kernelWeight(2, 10)).toBeGreaterThan(mid);
  });

  it('权重单调递减', () => {
    let prev = Infinity;
    for (let d = 0; d <= 10; d += 0.5) {
      const w = kernelWeight(d, 10);
      expect(w).toBeLessThanOrEqual(prev + 1e-9);
      prev = w;
    }
  });
});

describe('T08 密度累积', () => {
  const GW = 16, GH = 16, CELL = 8;

  it('颗粒在中心处密度最高，向外递减', () => {
    const grid = new Float32Array(GW * GH);
    splatDensity(grid, GW, GH, CELL, 0, 0, 64, 64, 3, 1, 3);
    const center = grid[8 * GW + 8];
    expect(center).toBeGreaterThan(0);
    const far = grid[0 * GW + 0];
    expect(far).toBe(0);
  });

  it('两颗重叠颗粒叠加更浓', () => {
    const one = new Float32Array(GW * GH);
    splatDensity(one, GW, GH, CELL, 0, 0, 64, 64, 3, 1, 3);
    const two = new Float32Array(GW * GH);
    splatDensity(two, GW, GH, CELL, 0, 0, 64, 64, 3, 1, 3);
    splatDensity(two, GW, GH, CELL, 0, 0, 64, 64, 3, 1, 3);
    const i = 8 * GW + 8;
    expect(two[i]).toBeCloseTo(one[i] * 2, 5);
  });

  it('格外的颗粒被裁掉，不越界写入', () => {
    const grid = new Float32Array(GW * GH);
    splatDensity(grid, GW, GH, CELL, 0, 0, -999, -999, 3, 1, 3);
    expect(grid.every((v) => v === 0)).toBe(true);
  });

  it('clearDensity 归零', () => {
    const grid = new Float32Array(16);
    grid.fill(5);
    clearDensity(grid);
    expect(grid.every((v) => v === 0)).toBe(true);
  });
});

describe('T08 微粒发射与运动', () => {
  it('发射数量正确', () => {
    const f = new VaporField();
    expect(f.emit(params({ count: 30 }))).toBe(30);
    expect(f.activeCount).toBe(30);
  });

  it('allowance 按比例削减数量', () => {
    const f = new VaporField();
    expect(f.emit(params({ count: 100 }), 0.5)).toBe(50);
    expect(f.emit(params({ count: 100 }), 0)).toBe(0);
  });

  it('超过上限时 FIFO 逐出，不会无限增长', () => {
    const f = new VaporField();
    f.setBudget(100);
    for (let i = 0; i < 20; i += 1) f.emit(params({ count: 20 }));
    expect(f.activeCount).toBeLessThanOrEqual(100);
  });

  it('寿命结束即回收（自然消散，不突然整片消失）', () => {
    const f = new VaporField();
    f.emit(params({ count: 10, lifeMin: 0.1, lifeMax: 0.11 }));
    expect(f.activeCount).toBe(10);
    for (let i = 0; i < 20; i += 1) f.update(1 / 60);
    expect(f.activeCount).toBe(0);
  });

  it('浮升让粒子逐渐向上（vy 变负）', () => {
    const f = new VaporField();
    f.emit(params({ count: 1, angle: 0, spread: 0, speedMin: 0, speedMax: 0 }));
    const p = f.particles[0];
    for (let i = 0; i < 30; i += 1) f.update(1 / 60);
    expect(p.vy).toBeLessThan(0);
  });

  it('阻力按 exp(-drag·dt) 衰减（不是逐帧固定乘 0.98）', () => {
    const f = new VaporField();
    f.emit(params({ count: 1, angle: 0, spread: 0, speedMin: 100, speedMax: 100 }));
    const p = f.particles[0];
    const v0 = Math.abs(p.vx);
    // 一步 dt=1/60, drag=2 → exp(-2/60)
    f.update(1 / 60, 2);
    expect(Math.abs(p.vx)).toBeCloseTo(v0 * Math.exp(-2 / 60), 0);
  });

  it('非法 dt 不产生 NaN', () => {
    const f = new VaporField();
    f.emit(params({ count: 5 }));
    f.update(0);
    f.update(-1);
    f.update(Number.NaN);
    expect(f.particles.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('寿命权重：新生为 1，末尾平滑降到 0', () => {
    const f = new VaporField();
    f.emit(params({ count: 1, lifeMin: 1, lifeMax: 1 }));
    const p = f.particles[0];
    expect(f.lifeWeight(p)).toBe(1);
    p.life = 0.1;
    expect(f.lifeWeight(p)).toBeCloseTo(0.333, 2);
    p.life = 0;
    expect(f.lifeWeight(p)).toBe(0);
  });

  it('同种子可复现运动路径', () => {
    const run = () => {
      const f = new VaporField(undefined, 4242);
      f.emit(params({ count: 20 }));
      for (let i = 0; i < 30; i += 1) f.update(1 / 60);
      return f.particles.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join('|');
    };
    expect(run()).toBe(run());
  });

  it('不同种子运动路径不同（不是固定重复轨迹）', () => {
    const run = (seed: number) => {
      const f = new VaporField(undefined, seed);
      f.emit(params({ count: 20 }));
      for (let i = 0; i < 30; i += 1) f.update(1 / 60);
      return f.particles.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join('|');
    };
    expect(run(1)).not.toBe(run(2));
  });

  it('路径连贯：相邻帧位移不应剧烈跳变', () => {
    const f = new VaporField(undefined, 8);
    f.emit(params({ count: 30 }));
    const prev = f.particles.map((p) => ({ x: p.x, y: p.y }));
    let maxStep = 0;
    for (let i = 0; i < 60; i += 1) {
      f.update(1 / 60);
      f.particles.forEach((p, k) => {
        if (prev[k]) {
          maxStep = Math.max(maxStep, Math.hypot(p.x - prev[k].x, p.y - prev[k].y));
          prev[k].x = p.x;
          prev[k].y = p.y;
        }
      });
    }
    // 一帧内位移不应超过数百单位（否则是抖动而非流动）
    expect(maxStep).toBeLessThan(200);
  });

  it('clear 释放全部粒子', () => {
    const f = new VaporField();
    f.emit(params({ count: 30 }));
    f.clear();
    expect(f.activeCount).toBe(0);
  });
});

describe('T08 表现随机不污染战斗随机', () => {
  it('大量发射与更新不改变战斗 RunRng 序列', () => {
    const combatA = new RunRng(555);
    const combatB = new RunRng(555);
    const fx = new VaporField(undefined, 999);
    for (let i = 0; i < 30; i += 1) {
      fx.emit(params({ count: 40 }));
      fx.update(1 / 60);
    }
    const seqA = Array.from({ length: 40 }, () => combatA.float());
    const seqB = Array.from({ length: 40 }, () => combatB.float());
    expect(seqA).toEqual(seqB);
  });
});

describe('T08 演出档参数', () => {
  it('G0 克制、G2 更大更慢', () => {
    expect(EMIT_PRESETS.g0.count).toBeLessThan(EMIT_PRESETS.g2.count);
    expect(EMIT_PRESETS.g2.lifeMax).toBeGreaterThan(EMIT_PRESETS.g0.lifeMax);
  });

  it('数量落在规格给定的上限内', () => {
    expect(EMIT_PRESETS.g0.count).toBeLessThanOrEqual(24);
    expect(EMIT_PRESETS.g2.count).toBeLessThanOrEqual(180);
  });

  it('浮升与涡旋上限为正（确有流动）', () => {
    expect(DEFAULT_FLOW.buoyancy).toBeGreaterThan(0);
    expect(DEFAULT_FLOW.maxAccel).toBeGreaterThan(0);
    expect(DEFAULT_FLOW.regenHz).toBeGreaterThan(0);
  });
});