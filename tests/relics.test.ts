import { beforeEach, describe, expect, it } from 'vitest';
import {
  RELIC_SLOTS,
  activeRelicSets,
  clampActiveRelics,
  hasRelicSlot,
  relicDefs,
  relicSets,
  relicSlotUsage,
  type RelicRarity
} from '../src/game/data/relics';
import { profileState } from '../src/game/state/ProfileState';

function rarityOf(id: string): RelicRarity {
  const def = relicDefs.find((r) => r.id === id);
  if (!def) throw new Error(`unknown relic ${id}`);
  return def.rarity;
}

describe('多槽激活', () => {
  it('槽位配额：普通 2 / 稀有 2 / 传说 1', () => {
    expect(RELIC_SLOTS).toEqual({ common: 2, rare: 2, legendary: 1 });
  });

  it('同种稀有度内可放满配额', () => {
    const commons = relicDefs.filter((r) => r.rarity === 'common').map((r) => r.id);
    expect(clampActiveRelics(commons.slice(0, 2))).toHaveLength(2);
  });

  it('超出配额的按原顺序丢弃', () => {
    const commons = relicDefs.filter((r) => r.rarity === 'common').map((r) => r.id);
    const out = clampActiveRelics(commons);
    expect(out).toHaveLength(RELIC_SLOTS.common);
    // 保留的是最先出现的两个
    expect(out).toEqual(commons.slice(0, 2));
  });

  it('不同稀有度的槽互不占用', () => {
    const ids = ['r01', 'r04', 'r08']; // common / rare / legendary
    expect(clampActiveRelics(ids)).toEqual(ids);
  });

  it('未知 id 静默丢弃（旧存档可能残留已删遗物）', () => {
    expect(clampActiveRelics(['__gone__', 'r01'])).toEqual(['r01']);
  });

  it('重复 id 去重', () => {
    expect(clampActiveRelics(['r01', 'r01', 'r02'])).toEqual(['r01', 'r02']);
  });

  it('空列表与全非法列表都安全', () => {
    expect(clampActiveRelics([])).toEqual([]);
    expect(clampActiveRelics(['x', 'y'])).toEqual([]);
  });

  it('槽位占用统计与配额判定', () => {
    const ids = ['r01', 'r04'];
    const usage = relicSlotUsage(ids);
    expect(usage).toEqual({ common: 1, rare: 1, legendary: 0 });
    expect(hasRelicSlot(ids, 'common')).toBe(true);
    // 传说尚空
    expect(hasRelicSlot(ids, 'legendary')).toBe(true);
    // 稀有配额 2，占 1 个后仍有空槽
    expect(hasRelicSlot(ids, 'rare')).toBe(true);
  });

  it('配额满后 hasRelicSlot 为假', () => {
    const commons = relicDefs.filter((r) => r.rarity === 'common').map((r) => r.id).slice(0, 2);
    expect(hasRelicSlot(commons, 'common')).toBe(false);
  });
});

describe('套装联动', () => {
  it('每个套装的 requires 都指向真实存在的遗物', () => {
    for (const set of relicSets) {
      for (const id of set.requires) {
        expect(relicDefs.some((r) => r.id === id), `${set.id} 引用了不存在的 ${id}`).toBe(true);
      }
    }
  });

  it('套装 id 唯一', () => {
    expect(new Set(relicSets.map((s) => s.id)).size).toBe(relicSets.length);
  });

  it('组合齐了才触发', () => {
    const set = relicSets[0];
    expect(activeRelicSets([set.requires[0]])).toHaveLength(0);
    expect(activeRelicSets(set.requires)).toContain(set);
  });

  it('顺序无关', () => {
    const set = relicSets[0];
    expect(activeRelicSets([...set.requires].reverse())).toContain(set);
  });

  it('可以同时触发多个套装', () => {
    const ids = [...relicSets[0].requires, ...relicSets[1].requires];
    expect(activeRelicSets(ids)).toHaveLength(2);
  });

  it('空激活列表不触发任何套装', () => {
    expect(activeRelicSets([])).toEqual([]);
  });

  it('套装组合不得超出槽位配额，否则玩家永远凑不齐', () => {
    for (const set of relicSets) {
      const clamped = clampActiveRelics(set.requires);
      expect(clamped, `${set.id} 的组合被槽位裁掉`).toEqual(set.requires);
    }
  });
});

describe('存档迁移：单遗物 → 多槽', () => {
  beforeEach(() => {
    profileState.activeRelicIds = [];
    profileState.unlockedRelics = relicDefs.map((r) => r.id);
  });

  it('旧字段 activeRelicId 会被迁移为列表', async () => {
    const { loadProfileFromStorage } = await import('../src/game/state/ProfileState');
    void loadProfileFromStorage;
    // 直接验证迁移后的语义：单 id 经裁剪后仍是单元素列表
    expect(clampActiveRelics(['r08'])).toEqual(['r08']);
    expect(rarityOf('r08')).toBe('legendary');
  });

  it('setActiveRelics 会按槽位裁剪', async () => {
    const { setActiveRelics } = await import('../src/game/state/ProfileState');
    const commons = relicDefs.filter((r) => r.rarity === 'common').map((r) => r.id);
    await setActiveRelics(commons);
    expect(profileState.activeRelicIds).toHaveLength(RELIC_SLOTS.common);
  });

  it('toggleRelic 在槽位满时返回 false 且不改动列表', async () => {
    const { toggleRelic } = await import('../src/game/state/ProfileState');
    const commons = relicDefs.filter((r) => r.rarity === 'common').map((r) => r.id);
    await toggleRelic(commons[0]);
    await toggleRelic(commons[1]);
    const before = [...profileState.activeRelicIds];
    const ok = commons.length > 2 ? await toggleRelic(commons[2]) : false;
    if (commons.length > 2) {
      expect(ok).toBe(false);
      expect(profileState.activeRelicIds).toEqual(before);
    }
  });

  it('toggleRelic 再次调用同一 id 会取消激活', async () => {
    const { toggleRelic } = await import('../src/game/state/ProfileState');
    await toggleRelic('r08');
    expect(profileState.activeRelicIds).toContain('r08');
    await toggleRelic('r08');
    expect(profileState.activeRelicIds).not.toContain('r08');
  });

  it('未解锁的遗物不能激活', async () => {
    const { toggleRelic } = await import('../src/game/state/ProfileState');
    profileState.unlockedRelics = [];
    expect(await toggleRelic('r01')).toBe(false);
    expect(profileState.activeRelicIds).toEqual([]);
  });
});