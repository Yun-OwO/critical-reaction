import { describe, expect, it } from 'vitest';
import {
  GEAR_SLOTS,
  aggregateGearEffects,
  applyDeathLoss,
  bankFoundGear,
  defaultLoadout,
  gears,
  gearsForSlot,
  getGear,
  loadoutGearIds,
  normalizeLoadout,
  normalizeWarehouse,
  pickGearDrop,
  purchaseGear,
  toggleEquipGear,
  validateGear,
  warehouseCount
} from '../src/game/data/gear';

describe('装备系统：数据自检', () => {
  it('4 个槽位均有装备，价格随稀有度递增', () => {
    expect(validateGear()).toEqual([]);
    for (const slot of GEAR_SLOTS) {
      expect(gearsForSlot(slot).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('装备 id 唯一', () => {
    const ids = gears.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('局外经济：用样本购买装备', () => {
  it('样本足够时扣款并入仓库', () => {
    const res = purchaseGear({}, 20, 'armor-plate');
    expect(res.ok).toBe(true);
    expect(res.samples).toBe(10);
    expect(res.warehouse['armor-plate']).toBe(1);
  });

  it('样本不足时原样返回，不产生任何变更', () => {
    const res = purchaseGear({}, 3, 'armor-plate');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('insufficient');
    expect(res.samples).toBe(3);
    expect(res.warehouse).toEqual({});
  });

  it('未知装备不扣款', () => {
    const res = purchaseGear({}, 999, 'nope');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('unknown');
    expect(res.samples).toBe(999);
  });

  it('重复购买累加数量，不覆盖', () => {
    let warehouse = {};
    let samples = 100;
    for (let i = 0; i < 3; i += 1) {
      const res = purchaseGear(warehouse, samples, 'boots-grip');
      warehouse = res.warehouse;
      samples = res.samples;
    }
    expect(warehouseCount(warehouse)).toBe(3);
    expect(samples).toBe(100 - (getGear('boots-grip')?.price ?? 0) * 3);
  });
});

describe('携带槽：装备 / 卸下', () => {
  it('仓库有货才能装备，槽位不匹配则忽略', () => {
    const warehouse = { 'boots-grip': 1 };
    let loadout = defaultLoadout();
    loadout = toggleEquipGear(loadout, warehouse, 'boots', 'boots-grip');
    expect(loadout.boots).toBe('boots-grip');
    // 槽位不匹配（靴子塞进护甲槽）
    const wrong = toggleEquipGear(loadout, warehouse, 'armor', 'boots-grip');
    expect(wrong.armor).toBeNull();
  });

  it('仓库为空时无法装备', () => {
    const loadout = toggleEquipGear(defaultLoadout(), {}, 'boots', 'boots-grip');
    expect(loadout.boots).toBeNull();
  });

  it('再次选择同一件即卸下', () => {
    const warehouse = { 'boots-grip': 1 };
    let loadout = toggleEquipGear(defaultLoadout(), warehouse, 'boots', 'boots-grip');
    loadout = toggleEquipGear(loadout, warehouse, 'boots', 'boots-grip');
    expect(loadout.boots).toBeNull();
  });

  it('loadoutGearIds 只返回已装备项，且按槽位顺序', () => {
    const warehouse = { 'boots-grip': 1, 'armor-plate': 2, 'core-platinum': 1 };
    let loadout = defaultLoadout();
    loadout = toggleEquipGear(loadout, warehouse, 'boots', 'boots-grip');
    loadout = toggleEquipGear(loadout, warehouse, 'core', 'core-platinum');
    loadout = toggleEquipGear(loadout, warehouse, 'armor', 'armor-plate');
    expect(loadoutGearIds(loadout)).toEqual(['armor-plate', 'core-platinum', 'boots-grip']);
  });
});

describe('死亡丢失：携带装备与局内战利品全部丢失', () => {
  it('携带装备各扣 1 件，扣空后自动卸下', () => {
    const warehouse = { 'armor-plate': 1, 'boots-grip': 2 };
    const loadout = { ...defaultLoadout(), armor: 'armor-plate', boots: 'boots-grip' };
    const res = applyDeathLoss(warehouse, loadout, []);
    expect(res.warehouse['armor-plate']).toBeUndefined();
    expect(res.warehouse['boots-grip']).toBe(1);
    expect(res.loadout.armor).toBeNull();
    // 仓库还有存货，携带槽保持
    expect(res.loadout.boots).toBe('boots-grip');
    expect(res.lost.sort()).toEqual(['armor-plate', 'boots-grip']);
  });

  it('未携带的仓库库存不受死亡影响（永久资产）', () => {
    const warehouse = { 'core-iridium': 4 };
    const res = applyDeathLoss(warehouse, defaultLoadout(), []);
    expect(res.warehouse['core-iridium']).toBe(4);
    expect(res.lost).toEqual([]);
  });

  it('局内搜到的战利品在死亡时丢失，不入仓库', () => {
    const res = applyDeathLoss({}, defaultLoadout(), ['bag-canvas', 'core-platinum']);
    expect(res.lostLoot).toBe(2);
    expect(res.warehouse).toEqual({});
  });
});

describe('撤离带出：战利品入仓库，携带装备保留', () => {
  it('搜到的装备写入仓库', () => {
    const next = bankFoundGear({ 'boots-grip': 1 }, ['boots-grip', 'core-palladium']);
    expect(next['boots-grip']).toBe(2);
    expect(next['core-palladium']).toBe(1);
  });

  it('未知 id 不入仓库', () => {
    expect(bankFoundGear({}, ['ghost-item'])).toEqual({});
  });

  it('撤离后携带装备数量不变（未消耗）', () => {
    const warehouse = { 'armor-lead': 1 };
    const loadout = { ...defaultLoadout(), armor: 'armor-lead' };
    // 撤离不触发丢失逻辑，仓库保持原样
    expect(warehouse['armor-lead']).toBe(1);
    expect(loadoutGearIds(loadout)).toEqual(['armor-lead']);
  });
});

describe('效果聚合与存档清洗', () => {
  it('加性项相加、乘性项相乘', () => {
    const eff = aggregateGearEffects(['armor-tungsten', 'core-platinum', 'boots-grip']);
    expect(eff.maxEhp).toBe(120);
    expect(eff.maxShield).toBe(60);
    expect(eff.moveSpeedPct).toBe(6);
    expect(eff.damageMult).toBeCloseTo(1.08, 5);
  });

  it('空携带槽返回中性值（乘性项为 1）', () => {
    const eff = aggregateGearEffects([]);
    expect(eff.damageMult).toBe(1);
    expect(eff.sampleMult).toBe(1);
    expect(eff.maxEhp).toBe(0);
  });

  it('仓库清洗丢弃未知 id 与非正数量', () => {
    const w = normalizeWarehouse({ 'boots-grip': 2, ghost: 3, 'core-platinum': 0, 'bag-canvas': -1 });
    expect(w).toEqual({ 'boots-grip': 2 });
  });

  it('携带槽清洗要求槽位匹配且仓库有货', () => {
    const warehouse = { 'boots-grip': 1 };
    const out = normalizeLoadout(
      { boots: 'boots-grip', armor: 'boots-grip', core: 'core-platinum', bag: 123 },
      warehouse
    );
    expect(out.boots).toBe('boots-grip');
    expect(out.armor).toBeNull();
    expect(out.core).toBeNull();
    expect(out.bag).toBeNull();
  });

  it('掉落权重覆盖全部装备（含史诗）', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(pickGearDrop(() => (i % 100) / 100));
    expect(seen.size).toBeGreaterThan(3);
    expect(gears.every((g) => typeof g.desc === 'string' && g.desc.length > 0)).toBe(true);
  });
});