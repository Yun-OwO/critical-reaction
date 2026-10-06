import { describe, expect, it } from 'vitest';
import {
  MAX_WEAPON_LEVEL,
  getWeapon,
  resolveWeaponModifiers,
  unlockedForm,
  weaponLevelBonus,
  weaponUpgradeCost,
  weapons
} from '../src/game/data/weapons';

describe('武器系统（§7）', () => {
  it('每把武器都定义了形态，且形态 id 互不重复', () => {
    for (const w of weapons) {
      expect(w.forms.length).toBeGreaterThanOrEqual(3);
      const ids = w.forms.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(w.forms.every((f) => f.name.length > 0 && f.desc.length > 0)).toBe(true);
    }
  });

  it('等级收益：每级 +5% 伤害、+3% 攻速（§7.3）', () => {
    expect(weaponLevelBonus(1)).toEqual({ damageMult: 1, cooldownMult: 1 });
    expect(weaponLevelBonus(2).damageMult).toBeCloseTo(1.05, 6);
    expect(weaponLevelBonus(3).damageMult).toBeCloseTo(1.1, 6);
    expect(weaponLevelBonus(3).cooldownMult).toBeCloseTo(0.94, 6);
    // 越级输入被夹取
    expect(weaponLevelBonus(99).damageMult).toBeCloseTo(1.1, 6);
    expect(weaponLevelBonus(0).damageMult).toBe(1);
  });

  it('升级消耗：满级返回 null，供 UI 禁用按钮', () => {
    expect(weaponUpgradeCost(1)).toBe(8);
    expect(weaponUpgradeCost(2)).toBe(20);
    expect(weaponUpgradeCost(MAX_WEAPON_LEVEL)).toBeNull();
  });

  it('形态必须满级才解锁（§7.3）', () => {
    expect(unlockedForm('platinum-knife', 'curie', 2)).toBeNull();
    expect(unlockedForm('platinum-knife', 'curie', 3)).not.toBeNull();
    expect(unlockedForm('platinum-knife', null, 3)).toBeNull();
    expect(unlockedForm('platinum-knife', '不存在的形态', 3)).toBeNull();
  });

  it('未满级 / 未选形态时不产生任何形态修正', () => {
    const none = resolveWeaponModifiers('platinum-knife', 1, null, 0);
    expect(none.damageMult).toBe(1);
    expect(none.cooldownMult).toBe(1);
    expect(none.rangeMult).toBe(1);
    expect(none.selfDamagePerSec).toBe(0);
    // 选了形态但没满级同样无效
    expect(resolveWeaponModifiers('platinum-knife', 2, 'curie', 0).damageMult).toBeCloseTo(1.05, 6);
  });

  it('形态修正与等级收益叠乘', () => {
    const mods = resolveWeaponModifiers('platinum-knife', 3, 'curie', 0);
    // 等级 1.1 × 居里 1.3
    expect(mods.damageMult).toBeCloseTo(1.43, 6);
    expect(mods.selfDamagePerSec).toBe(3);
  });

  it('拉瓦锡：氧化加成与还原减益分别生效', () => {
    const mods = resolveWeaponModifiers('platinum-knife', 3, 'lavoisier', 0);
    expect(mods.oxidizeMult).toBeCloseTo(1.35, 6);
    expect(mods.reduceMult).toBeCloseTo(0.8, 6);
  });

  it('道尔顿：伤害随负载提升，负载为 0 时不额外加成', () => {
    const empty = resolveWeaponModifiers('platinum-knife', 3, 'dalton', 0);
    const heavy = resolveWeaponModifiers('platinum-knife', 3, 'dalton', 1);
    expect(empty.damageMult).toBeCloseTo(1.1, 6);
    expect(heavy.damageMult).toBeCloseTo(1.1 * 1.6, 6);
    // 超载不会无限增长（比值被 max(0) 保护，但允许 >1 的收益）
    expect(Number.isFinite(resolveWeaponModifiers('platinum-knife', 3, 'dalton', 5).damageMult)).toBe(true);
  });

  it('本生灯提高升温倍率（放热的代价）', () => {
    const mods = resolveWeaponModifiers('reaction-cannon', 3, 'bunsen', 0);
    expect(mods.heatMult).toBeCloseTo(1.5, 6);
    expect(mods.damageMult).toBeCloseTo(1.1 * 1.2, 6);
  });

  it('氧炔扩大范围与射程', () => {
    const mods = resolveWeaponModifiers('reaction-cannon', 3, 'oxyacetylene', 0);
    expect(mods.aoeMult).toBeCloseTo(1.3, 6);
    expect(mods.rangeMult).toBeCloseTo(1.1, 6);
  });

  it('getWeapon 对未知 id 回退到第一把武器（不抛错）', () => {
    expect(getWeapon('不存在').id).toBe(weapons[0].id);
    expect(getWeapon('reaction-cannon').type).toBe('ranged');
  });

  it('武器基础数值保持文档口径（近战慢而重、远程快而轻）', () => {
    const knife = getWeapon('platinum-knife');
    const cannon = getWeapon('reaction-cannon');
    expect(knife.baseDamage).toBeGreaterThan(cannon.baseDamage);
    // v0.2.1：冷却统一走 BALANCE.combat.baseAttackInterval（0.4s），近远程手感差异交给伤害/射程
    expect(knife.cooldown).toBe(cannon.cooldown);
    expect(knife.cooldown).toBeCloseTo(0.4, 6);
    expect(cannon.range).toBeGreaterThan(knife.range);
  });
});