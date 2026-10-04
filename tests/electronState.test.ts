import { describe, expect, it } from 'vitest';
import {
  ELECTRON_STATE_RULES,
  describeElectronState,
  overloadTick
} from '../src/game/combat/electronState';

describe('氧化态 / 还原态修正（§2.1）', () => {
  it('满电子且无自由电子时为基态，无任何修正', () => {
    const s = describeElectronState(4, 4, 0, 2);
    expect(s.label).toBe('基态');
    expect(s.lost).toBe(0);
    expect(s.damageMult).toBe(1);
    expect(s.moveSpeedBonus).toBe(0);
    expect(s.cdReduction).toBe(0);
    expect(s.shieldBonusPct).toBe(0);
    expect(s.overOxidized).toBe(false);
    expect(s.overloaded).toBe(false);
  });

  it('氧化态：每失去 1 颗价电子，伤害 +10%、移速 +5%', () => {
    const s = describeElectronState(2, 4, 0, 2);
    expect(s.label).toBe('氧化态');
    expect(s.lost).toBe(2);
    expect(s.damageMult).toBeCloseTo(1.2, 6);
    expect(s.moveSpeedBonus).toBe(10);
  });

  it('还原态：每持有 1 颗自由电子，冷却 -10%、护盾上限 +10%', () => {
    const s = describeElectronState(4, 4, 1, 4);
    expect(s.label).toBe('还原态');
    expect(s.extra).toBe(1);
    expect(s.cdReduction).toBe(10);
    expect(s.shieldBonusPct).toBe(10);
    expect(s.damageMult).toBe(1);
  });

  it('只剩最后一颗价电子时进入过氧化（濒死）', () => {
    const s = describeElectronState(1, 4, 0, 2);
    expect(s.overOxidized).toBe(true);
    expect(s.label).toBe('过氧化');
    // 濒死同时保留氧化态的全部进攻加成
    expect(s.damageMult).toBeCloseTo(1.3, 6);
  });

  it('过载由调用方按温度传入，与自由电子是否满仓无关', () => {
    // 满仓但温度未超限：不再触发旧「过还原」规则
    const cool = describeElectronState(4, 4, 3, 3, false);
    expect(cool.overloaded).toBe(false);
    expect(cool.label).toBe('还原态');
    // 温度超限即过载，即使电子不满仓
    const hot = describeElectronState(4, 4, 0, 3, true);
    expect(hot.overloaded).toBe(true);
    expect(hot.label).toBe('过载');
    expect(hot.damageMult).toBeCloseTo(ELECTRON_STATE_RULES.overloadDamageMult, 6);
  });

  it('过载优先级高于过氧化（同时满足时以过载为准）', () => {
    const s = describeElectronState(1, 4, 0, 2, true);
    expect(s.label).toBe('过载');
  });

  it('异常输入被夹取，不产生反向加成', () => {
    const negative = describeElectronState(-5, 4, -3, 2);
    expect(negative.lost).toBe(4);
    expect(negative.extra).toBe(0);
    expect(negative.damageMult).toBeGreaterThan(1);

    const overflow = describeElectronState(99, 4, 99, 2);
    expect(overflow.lost).toBe(0);
    expect(overflow.extra).toBe(2);
  });

  it('移速与伤害随失去电子数单调递增（越残越猛）', () => {
    const a = describeElectronState(4, 5, 0, 2);
    const b = describeElectronState(3, 5, 0, 2);
    const c = describeElectronState(2, 5, 0, 2);
    expect(a.damageMult).toBeLessThan(b.damageMult);
    expect(b.damageMult).toBeLessThan(c.damageMult);
    expect(a.moveSpeedBonus).toBeLessThan(c.moveSpeedBonus);
  });

  it('周期结算按秒触发，与帧率解耦', () => {
    expect(overloadTick(0.5)).toBe(false);
    expect(overloadTick(1)).toBe(true);
    expect(overloadTick(1.7)).toBe(true);
  });

  it('规则表数值可被覆盖（供平衡调整与测试注入）', () => {
    const s = describeElectronState(3, 4, 0, 2, false, { ...ELECTRON_STATE_RULES, damagePerLost: 0.5 });
    expect(s.damageMult).toBeCloseTo(1.5, 6);
  });
});
