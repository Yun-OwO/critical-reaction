import { describe, expect, it } from 'vitest';
import { BALANCE, validateBalance } from '../src/game/data/balance';
import { BASE_BAG_CAPACITY } from '../src/game/combat/load';
import { WEAPON_UPGRADE_COSTS } from '../src/game/data/weapons';

describe('平衡配置', () => {
  it('自检通过：没有手滑改出破坏体验的数值', () => {
    expect(validateBalance()).toEqual([]);
  });

  it('经济闭环：撤离是变现途径，死亡会丢失未保险样本', () => {
    // 这是本作"搜打撤"支柱的底线：若死亡也能带出样本，撤离就失去意义
    expect(BALANCE.economy.loseCarriedSamplesOnDeath).toBe(true);
  });

  it('样本来源与支出量级匹配（支出不会远超一次满仓产出）', () => {
    const maxRelicSpend = BALANCE.economy.relicUpgradeCosts.reduce((a, b) => a + b, 0);
    const maxWeaponSpend = BALANCE.economy.weaponUpgradeCosts.reduce((a, b) => a + b, 0);
    // 一次完整搜刮约等于一个满背包的样本量；单件满级培养不应超过这个量级
    expect(maxRelicSpend).toBeLessThanOrEqual(BASE_BAG_CAPACITY);
    expect(maxWeaponSpend).toBeLessThanOrEqual(BASE_BAG_CAPACITY);
  });

  it('武器升级花费与 weapons.ts 中的定义保持一致（避免两处漂移）', () => {
    expect([...BALANCE.economy.weaponUpgradeCosts]).toEqual([...WEAPON_UPGRADE_COSTS]);
  });

  it('温度可回落：非战斗散热必须强于战斗升温', () => {
    expect(BALANCE.temperature.coolOutOfCombat).toBeGreaterThan(BALANCE.temperature.riseBase);
    expect(BALANCE.temperature.coolInCombat).toBeLessThan(BALANCE.temperature.coolOutOfCombat);
  });

  it('升温随温度加速（越热升得越快，形成撤离压力曲线）', () => {
    const riseAt = (temp: number): number => BALANCE.temperature.riseHeatScale * (temp / 100) + BALANCE.temperature.riseBase;
    expect(riseAt(90)).toBeGreaterThan(riseAt(30));
  });

  it('高温缩短波次间隔但有下限（不会出现瞬时无限刷怪）', () => {
    expect(BALANCE.temperature.waveCooldownMin).toBeGreaterThan(0);
    const cooldownAt = (temp: number): number =>
      Math.max(BALANCE.temperature.waveCooldownMin, BALANCE.temperature.waveCooldownBase - (temp / 100) * BALANCE.temperature.waveCooldownHeatScale);
    expect(cooldownAt(0)).toBe(BALANCE.temperature.waveCooldownBase);
    // 温度越高间隔越短
    expect(cooldownAt(100)).toBeLessThan(cooldownAt(0));
    // 超出 100 度也不会跌破下限
    expect(cooldownAt(200)).toBe(BALANCE.temperature.waveCooldownMin);
  });

  it('冲刺手感参数在可玩区间内', () => {
    expect(BALANCE.dash.velocity).toBeGreaterThan(BALANCE.player.maxVelocity);
    expect(BALANCE.dash.maxVelocity).toBeGreaterThanOrEqual(BALANCE.dash.velocity);
    expect(BALANCE.dash.windowSeconds).toBeGreaterThan(BALANCE.dash.nextReadySeconds);
  });
});