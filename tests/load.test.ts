import { describe, expect, it } from 'vitest';
import {
  BASE_BAG_CAPACITY,
  LOAD_BANDS,
  describeLoad,
  loadDashCdMult,
  loadSpeedMult
} from '../src/game/combat/load';

describe('负载系统（§4.3）', () => {
  it('档位表严格按设计文档：0-25/25-50/50-75/75-100/>100', () => {
    expect(LOAD_BANDS[0].speedMult).toBe(1.0);
    expect(LOAD_BANDS[1].speedMult).toBe(0.9);
    expect(LOAD_BANDS[2].speedMult).toBe(0.75);
    expect(LOAD_BANDS[3].speedMult).toBe(0.55);
    expect(LOAD_BANDS[4].speedMult).toBe(0.4);
    expect(LOAD_BANDS[0].dashCdMult).toBe(1.0);
    expect(LOAD_BANDS[1].dashCdMult).toBe(1.15);
    expect(LOAD_BANDS[2].dashCdMult).toBe(1.35);
    expect(LOAD_BANDS[3].dashCdMult).toBe(1.6);
    expect(LOAD_BANDS[4].dashCdMult).toBe(2.0);
  });

  it('空背包为轻载，无任何惩罚', () => {
    const load = describeLoad(0, BASE_BAG_CAPACITY);
    expect(load.band.label).toBe('轻载');
    expect(load.percent).toBe(0);
    expect(loadSpeedMult(0, BASE_BAG_CAPACITY)).toBe(1);
    expect(loadDashCdMult(0, BASE_BAG_CAPACITY)).toBe(1);
  });

  it('超过容量进入满仓档，而不是继续恶化（避免无限惩罚）', () => {
    const load = describeLoad(999, 100);
    expect(load.band.label).toBe('满仓');
    expect(load.ratio).toBeCloseTo(9.99, 2);
    expect(loadSpeedMult(999, 100)).toBe(0.4);
  });

  it('档位边界取上半区（25% 恰好落在常载）', () => {
    expect(describeLoad(25, 100).band.label).toBe('常载');
    expect(describeLoad(24, 100).band.label).toBe('轻载');
    expect(describeLoad(50, 100).band.label).toBe('重载');
    expect(describeLoad(75, 100).band.label).toBe('超载');
    expect(describeLoad(100, 100).band.label).toBe('满仓');
  });

  it('负载百分比用于 HUD 展示', () => {
    expect(describeLoad(45, 100).percent).toBe(45);
    expect(describeLoad(1, 3).percent).toBe(33);
  });

  it('容量非法输入被保护，不产生 Infinity 或负倍率', () => {
    const zero = describeLoad(10, 0);
    expect(Number.isFinite(zero.ratio)).toBe(true);
    expect(zero.band.speedMult).toBeGreaterThan(0);
    const negative = describeLoad(-5, 100);
    expect(negative.carried).toBe(0);
    expect(negative.band.speedMult).toBe(1);
  });

  it('移速随负载单调不增、冲刺冷却单调不减', () => {
    const carried = [0, 30, 60, 90, 200];
    for (let i = 1; i < carried.length; i += 1) {
      expect(loadSpeedMult(carried[i], BASE_BAG_CAPACITY))
        .toBeLessThanOrEqual(loadSpeedMult(carried[i - 1], BASE_BAG_CAPACITY));
      expect(loadDashCdMult(carried[i], BASE_BAG_CAPACITY))
        .toBeGreaterThanOrEqual(loadDashCdMult(carried[i - 1], BASE_BAG_CAPACITY));
    }
  });

  it('扩容背包后同样样本量落入更轻的档位（扩容有实际收益）', () => {
    const carried = 100;
    // 100/120 = 83% → 超载；100/140 = 71% → 重载
    expect(describeLoad(carried, BASE_BAG_CAPACITY).band.label).toBe('超载');
    expect(describeLoad(carried, BASE_BAG_CAPACITY + 20).band.label).toBe('重载');
  });
});