import { describe, expect, it } from 'vitest';
import { BOON_POOL, formatBoonDesc, getBoonDef } from '../src/game/data/upgrades';

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
