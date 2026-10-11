import { describe, expect, it } from 'vitest';
import { BOON_POOL, formatBoonDesc, getBoonDef, pickBoons } from '../src/game/data/upgrades';

/**
 * 祝福描述按「当前手持武器」分类展示。
 *
 * 玩家每局同时持有近战刀与远程炮、可随时切换，同一祝福在两把武器下的实际生效量
 * 可能不同（等离子体：近战加挥斩半径、远程光束长度固定已满屏、实际加的是光束宽度）。
 * 这些测试锁住文案与实际效果对得上，避免再出现「写着加范围、实际加的是宽度」。
 */
describe('祝福描述（按武器分类展示）', () => {
  const byId = (id: string) => {
    const def = getBoonDef(id);
    expect(def, `${id} 应存在于祝福池`).toBeDefined();
    return def!;
  };

  it('声明了 weaponDesc 的祝福必须把两种武器都给全，且键合法', () => {
    for (const boon of BOON_POOL) {
      if (!boon.weaponDesc) continue;
      // 缺一侧不会报错、只会静默回落到通用 desc，等于该武器的分类展示失效
      expect(Object.keys(boon.weaponDesc).sort(), `${boon.id} 的 weaponDesc`).toEqual(['melee', 'ranged']);
      for (const text of Object.values(boon.weaponDesc)) {
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });

  it('等离子体：近战写挥斩半径、远程写光束宽度', () => {
    const boon = byId('o-sp-plasma');
    expect(formatBoonDesc(boon, 'melee')).toContain('挥斩范围');
    expect(formatBoonDesc(boon, 'ranged')).toContain('光束宽度');
  });

  it('多相催化 / 分子间力：近战文案不照搬远程（近战效果已单独适配）', () => {
    expect(formatBoonDesc(byId('cat-sp-multi'), 'melee')).toContain('甩出');
    expect(formatBoonDesc(byId('cat-sp-multi'), 'ranged')).toContain('发射');
    expect(formatBoonDesc(byId('cat-sp-homing'), 'melee')).toContain('牵引');
    expect(formatBoonDesc(byId('cat-sp-homing'), 'ranged')).toContain('追踪');
  });

  it('未指定武器、或该祝福无 weaponDesc 时，三种写法结果一致', () => {
    const boon = byId('cat-dash-echo'); // 无 weaponDesc 的普通祝福
    expect(formatBoonDesc(boon, 'melee')).toBe(formatBoonDesc(boon, 'ranged'));
    expect(formatBoonDesc(boon)).toBe(formatBoonDesc(boon, 'melee'));
    expect(formatBoonDesc(boon)).not.toContain('{n}');
  });

  it('weaponDesc 同样会替换 {n} 占位符', () => {
    const boon = byId('cat-sp-multi');
    const v = Math.round(boon.rarityScale[boon.rarity]);
    const text = formatBoonDesc(boon, 'melee');
    expect(text).toContain(String(v));
    expect(text).not.toContain('{n}');
  });
});

/**
 * 抽卡多样性。
 *
 * pickBoons 的注释长期声称「优先覆盖不同槽位，其次不同学派」，但 usedSchools
 * 只被 add、从不用于筛选 —— 三张卡经常同属一个学派，四大化学学派的主题感会崩。
 * 这里锁住两件事：槽位不重复是硬约束，学派撞车率必须压到接近 0。
 */
describe('抽卡多样性', () => {
  /** 确定性 LCG，避免用 Math.random 让测试偶发失败。 */
  const lcg = (seed: number): (() => number) => {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  };

  it('每轮 3 张卡 id 互不相同、槽位互不相同', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const picks = pickBoons(3, lcg(seed));
      expect(picks).toHaveLength(3);
      expect(new Set(picks.map((b) => b.id)).size, `seed=${seed} id`).toBe(3);
      expect(new Set(picks.map((b) => b.slot)).size, `seed=${seed} slot`).toBe(3);
    }
  });

  it('学派撞车率接近 0（旧实现在此处约为 60%）', () => {
    let collide = 0;
    const rounds = 300;
    for (let seed = 1; seed <= rounds; seed += 1) {
      const picks = pickBoons(3, lcg(seed));
      if (new Set(picks.map((b) => b.school)).size < 3) collide += 1;
    }
    expect(collide / rounds).toBeLessThan(0.05);
  });

  it('exclude 排除后仍返回不重复且数量正确', () => {
    const first = pickBoons(3, lcg(7));
    const second = pickBoons(3, lcg(7), new Set(first.map((b) => b.id)));
    expect(second).toHaveLength(3);
    expect(new Set(second.map((b) => b.id)).size).toBe(3);
    for (const b of second) expect(first.some((f) => f.id === b.id)).toBe(false);
  });
});
