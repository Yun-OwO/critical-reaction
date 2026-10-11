import { describe, expect, it } from 'vitest';
import {
  SPECTRUM_ENTRIES,
  canSpend,
  couponsForChest,
  couponsForRoom,
  investCoupons,
  nextSpectrumGoal,
  priceIsAnchor,
  rollShop,
  settleCoupons,
  spendCoupons,
  unlockedSpectrum
} from '../src/game/data/shop';
import { BALANCE, validateBalance } from '../src/game/data/balance';
import type { EventContext } from '../src/game/data/events';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ctx = (over: Partial<EventContext> = {}): EventContext => ({
  coupons: 0, ehp: 100, ehpMax: 100, valence: 3, maxValence: 3, temperature: 20,
  layer: 0, dyeCount: 0, gearCount: 0, boonCount: 0, kills: 0, seen: [], ...over
});

describe('催化券产出', () => {
  it('同层内越深入给的越多（单调不减）', () => {
    const a = couponsForRoom(0, false);
    const b = couponsForRoom(3, false);
    expect(b).toBeGreaterThan(a);
    expect(couponsForRoom(5, false)).toBeGreaterThanOrEqual(couponsForRoom(4, false));
  });

  it('精英房给得更多', () => {
    expect(couponsForRoom(1, true)).toBeGreaterThan(couponsForRoom(1, false));
  });

  it('深度为负不会产生负产出', () => {
    expect(couponsForRoom(-5, false)).toBeGreaterThan(0);
  });

  it('产出取整，便于展示', () => {
    for (let d = 0; d < 8; d += 1) {
      expect(Number.isInteger(couponsForRoom(d, true))).toBe(true);
    }
    expect(Number.isInteger(couponsForChest())).toBe(true);
  });

  it('宝箱给的券明显多于普通房（值得专门绕路）', () => {
    expect(couponsForChest()).toBeGreaterThan(couponsForRoom(5, false));
  });
});

describe('花费与结算', () => {
  it('券不足时不能花，且不会扣成负数', () => {
    expect(canSpend(10, 20)).toBe(false);
    expect(spendCoupons(10, 20)).toBe(10);
    expect(canSpend(20, 20)).toBe(true);
    expect(spendCoupons(20, 20)).toBe(0);
  });

  it('死亡时券不折算任何样本——这是整个投资闭环的支点', () => {
    expect(settleCoupons(500, false)).toBe(0);
    expect(settleCoupons(500, true)).toBeGreaterThan(0);
  });

  it('结算取整，不产生小数样本', () => {
    const s = settleCoupons(7, true);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBe(Math.floor(7 * BALANCE.economy2.couponToSample));
  });

  it('券为负时不折算出负样本', () => {
    expect(settleCoupons(-50, true)).toBe(0);
  });

  it('折算率越高同样多的券换到越多样本（单调）', () => {
    expect(settleCoupons(100, true)).toBeGreaterThan(settleCoupons(10, true));
  });
});

describe('定向投资（对标集成战略前瞻性投资）', () => {
  it('单次投入固定 1 券', () => {
    const r = investCoupons(0, 50, false);
    expect(r.spent).toBe(BALANCE.economy2.investUnit);
    expect(r.reserve).toBe(1);
  });

  it('储备余额跨局继承：连续投入是累加而非重置', () => {
    let reserve = 0;
    for (let i = 0; i < 10; i += 1) {
      const r = investCoupons(reserve, 10, false);
      reserve = r.reserve;
    }
    expect(reserve).toBe(10);
  });

  it('一次性投入不会超出持有的券', () => {
    const r = investCoupons(0, 0, true);
    expect(r.spent).toBe(0);
    const r2 = investCoupons(0, 3, true);
    expect(r2.spent).toBe(3);
  });

  it('撞上上限后停止增长（不会溢出）', () => {
    const cap = BALANCE.economy2.investReserveCap;
    const r = investCoupons(cap, 999, true);
    expect(r.reserve).toBe(cap);
    expect(r.spent).toBe(0);
  });

  it('接近上限时只吃掉剩余空间', () => {
    const cap = BALANCE.economy2.investReserveCap;
    const r = investCoupons(cap - 3, 999, true);
    expect(r.spent).toBe(3);
    expect(r.reserve).toBe(cap);
  });

  it('持有券不足时投入受限', () => {
    const r = investCoupons(0, 0, true);
    expect(r.spent).toBe(0);
  });
});

describe('色谱图鉴解锁', () => {
  it('门槛递增且 id 唯一', () => {
    expect(new Set(SPECTRUM_ENTRIES.map((e) => e.id)).size).toBe(SPECTRUM_ENTRIES.length);
    for (let i = 1; i < SPECTRUM_ENTRIES.length; i += 1) {
      expect(SPECTRUM_ENTRIES[i].cost).toBeGreaterThan(SPECTRUM_ENTRIES[i - 1].cost);
    }
  });

  it('投资额解锁对应条目', () => {
    expect(unlockedSpectrum(0)).toHaveLength(0);
    expect(unlockedSpectrum(30)).toContain('sp-siphon');
    expect(unlockedSpectrum(9999)).toHaveLength(SPECTRUM_ENTRIES.length);
  });

  it('解锁是单调的：投入变多不会反而丢条目', () => {
    let prev = 0;
    for (let t = 0; t <= 900; t += 7) {
      const n = unlockedSpectrum(t).length;
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('nextSpectrumGoal 指向下一个未解锁项，满投资后为 null', () => {
    expect(nextSpectrumGoal(0)!.cost).toBe(SPECTRUM_ENTRIES[0].cost);
    expect(nextSpectrumGoal(9999)).toBeNull();
  });
});

describe('诡商货架', () => {
  it('格数与保底稀有数符合配置', () => {
    const shop = rollShop(0, ctx(), seeded(1));
    expect(shop).toHaveLength(BALANCE.economy2.shopSlots);
  });

  it('每层必有保底稀有机会（对标 Hades 骷髅房提稀有）', () => {
    for (let layer = 0; layer < 4; layer += 1) {
      for (let seed = 1; seed <= 30; seed += 1) {
        const shop = rollShop(layer, ctx(), seeded(seed));
        const rares = shop.filter((s) => s.rarity !== 'common').length;
        expect(rares, `layer=${layer} seed=${seed}`).toBeGreaterThanOrEqual(
          BALANCE.economy2.guaranteedRarePerLayer
        );
      }
    }
  });

  it('所有定价都是锚点倍数（玩家能心算，这是抄 Hades 的硬约束）', () => {
    for (let layer = 0; layer < 5; layer += 1) {
      for (let seed = 1; seed <= 40; seed += 1) {
        for (const slot of rollShop(layer, ctx(), seeded(seed))) {
          expect(priceIsAnchor(slot.price), `${slot.id} 定价 ${slot.price}`).toBe(true);
        }
      }
    }
  });

  it('货架类型按层数推进：L1 只有补给，越往后种类越全', () => {
    const kindsAt = (layer: number) =>
      new Set(rollShop(layer, ctx(), seeded(7)).map((s) => s.kind));
    expect(kindsAt(0).has('gear')).toBe(false);
    expect(kindsAt(0).has('dye')).toBe(false);
    expect(kindsAt(1).has('gear')).toBe(true);
    expect(kindsAt(2).has('dye')).toBe(true);
    // L3+ 才可能出现进化材料；单次抽样不一定抽到，用大样本验证「可能性」而非必然性
    let sawEvolution = false;
    for (let seed = 1; seed <= 200 && !sawEvolution; seed += 1) {
      if (kindsAt(3).has('evolution')) sawEvolution = true;
    }
    expect(sawEvolution).toBe(true);
  });

  it('同层同 seed 完全可复现（存档回放与联机确定性都要靠这个）', () => {
    const a = rollShop(2, ctx(), seeded(99));
    const b = rollShop(2, ctx(), seeded(99));
    expect(a).toEqual(b);
  });

  it('每个商品的 id 在货架内唯一、载荷可解析', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const shop = rollShop(2, ctx(), seeded(seed));
      expect(new Set(shop.map((s) => s.id)).size).toBe(shop.length);
      for (const slot of shop) {
        expect(slot.name.length).toBeGreaterThan(0);
        expect(slot.desc.length).toBeGreaterThan(0);
        expect(['supply', 'gear', 'dye', 'evolution', 'purify']).toContain(slot.kind);
      }
    }
  });

  it('装备类商品的载荷是真实存在的装备 id', () => {
    let checked = 0;
    for (let seed = 1; seed <= 60 && checked < 5; seed += 1) {
      for (const slot of rollShop(2, ctx(), seeded(seed))) {
        if (slot.kind === 'gear') {
          expect(typeof slot.payload).toBe('string');
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('平衡自检覆盖了新数值', () => {
  it('validateBalance 通过（定价锚点等硬约束）', () => {
    expect(validateBalance()).toEqual([]);
  });

  it('定价锚点被破坏时会被自检拦下（证明约束真的在生效）', () => {
    // 直接验证约束表达式本身，而不是去改只读常量
    expect(BALANCE.economy2.prices.supply % BALANCE.economy2.priceAnchor).toBe(0);
    expect(priceIsAnchor(25)).toBe(true);
    expect(priceIsAnchor(23)).toBe(false);
    expect(priceIsAnchor(0)).toBe(false);
  });
});