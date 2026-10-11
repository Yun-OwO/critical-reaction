/**
 * 事件结算在 GameScene 上的落地效果（纯状态层面）。
 *
 * data/events.test.ts 覆盖的是「resolve 返回什么」，
 * 这里覆盖的是「拿到这些增量之后，局内状态变成什么样」——
 * 包括那些只在接线时才暴露的问题：EHP 上限能不能被压到 0 以下、
 * 卖装备是不是只动局内携带列表而不动局外仓库。
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { getEvent, optionAvailable } from '../src/game/data/events';
import { gameState, resetRun } from '../src/game/state/GameState';

/** 与 GameScene.applyEventOutcome 保持同构的落地逻辑（不含 Phaser 表现）。 */
function applyOutcome(o: {
  coupons?: number; ehp?: number; ehpMax?: number; temperature?: number;
  freeElectrons?: number; dyes?: string[]; flags?: string[]; nextCombatHpMult?: number;
}): { runDamageBonus: number; nextCombatHpMult: number } {
  if (o.coupons) gameState.coupons = Math.max(0, gameState.coupons + o.coupons);
  if (o.ehp) gameState.ehp = Math.max(0, gameState.ehp + o.ehp);
  if (o.ehpMax) gameState.ehpMax = Math.max(1, gameState.ehpMax + o.ehpMax);
  if (o.temperature) gameState.temperature = Math.min(100, Math.max(0, gameState.temperature + o.temperature));
  if (o.freeElectrons) {
    gameState.freeElectrons = Math.min(gameState.maxFreeElectrons, gameState.freeElectrons + o.freeElectrons);
  }
  for (const dyeId of o.dyes ?? []) {
    const empty = gameState.dyeSlots.find((s) => !s.dyeId);
    const target = empty ?? gameState.dyeSlots[0];
    target.dyeId = dyeId;
    target.purity = empty ? 1 : 0.25;
  }
  if (o.flags?.includes('sold-gear') && gameState.carriedGear.length > 0) gameState.carriedGear.shift();
  if (o.flags?.includes('burned-boon') && gameState.equippedBoons.length > 0) {
    const idx = gameState.equippedBoons.reduce(
      (min, b, i, arr) => (b.level < arr[min].level ? i : min), 0
    );
    gameState.equippedBoons.splice(idx, 1);
  }
  if (o.flags?.includes('debt-carry') && gameState.carriedGear.length > 0) gameState.carriedGear.pop();
  const nextCombatHpMult = o.nextCombatHpMult ?? 1;
  const runDamageBonus = o.flags?.includes('trial-buff') ? 0.12 : 0;
  return { runDamageBonus, nextCombatHpMult };
}

function ctx() {
  return {
    coupons: gameState.coupons, ehp: gameState.ehp, ehpMax: gameState.ehpMax,
    valence: gameState.valence, maxValence: gameState.maxValence,
    temperature: gameState.temperature, layer: gameState.layer,
    dyeCount: gameState.dyeSlots.filter((s) => s.dyeId).length,
    gearCount: gameState.carriedGear.length,
    boonCount: gameState.equippedBoons.length,
    kills: gameState.kills, seen: gameState.seenEvents
  };
}

beforeEach(() => {
  resetRun();
});

describe('局内增量落地', () => {
  it('券不会扣成负数', () => {
    gameState.coupons = 5;
    applyOutcome({ coupons: -20 });
    expect(gameState.coupons).toBe(0);
  });

  it('EHP 不会被扣成负数', () => {
    gameState.ehp = 10;
    applyOutcome({ ehp: -15 });
    expect(gameState.ehp).toBe(0);
  });

  it('EHP 上限有下限 1，不会被「以身试药」压成 0', () => {
    gameState.ehpMax = 25;
    applyOutcome({ ehpMax: -20 });
    expect(gameState.ehpMax).toBe(5);
    gameState.ehpMax = 5;
    applyOutcome({ ehpMax: -20 });
    expect(gameState.ehpMax).toBe(1);
  });

  it('温度夹在 0..100', () => {
    gameState.temperature = 10;
    applyOutcome({ temperature: -30 });
    expect(gameState.temperature).toBe(0);
    gameState.temperature = 95;
    applyOutcome({ temperature: 30 });
    expect(gameState.temperature).toBe(100);
  });

  it('自由电子不超过上限', () => {
    gameState.maxFreeElectrons = 3;
    gameState.freeElectrons = 3;
    applyOutcome({ freeElectrons: 2 });
    expect(gameState.freeElectrons).toBe(3);
  });

  it('染色优先填空槽，全满则替换主槽且纯度降为底槽', () => {
    applyOutcome({ dyes: ['D01'] });
    expect(gameState.dyeSlots[0].dyeId).toBe('D01');
    expect(gameState.dyeSlots[0].purity).toBe(1);

    applyOutcome({ dyes: ['D02'] });
    applyOutcome({ dyes: ['D03'] });
    expect(gameState.dyeSlots.map((s) => s.dyeId)).toEqual(['D01', 'D02', 'D03']);

    applyOutcome({ dyes: ['D04'] });
    expect(gameState.dyeSlots[0].dyeId).toBe('D04');
    expect(gameState.dyeSlots[0].purity).toBe(0.25);
  });
});

describe('代价类 flag 的语义', () => {
  it('卖装备只动局内携带列表', () => {
    gameState.carriedGear = ['armor-plate', 'core-platinum'];
    applyOutcome({ coupons: 45, flags: ['sold-gear'] });
    expect(gameState.carriedGear).toEqual(['core-platinum']);
    expect(gameState.coupons).toBe(45);
  });

  it('没装备时卖不掉，也不报错', () => {
    gameState.carriedGear = [];
    expect(() => applyOutcome({ flags: ['sold-gear'] })).not.toThrow();
    expect(gameState.carriedGear).toEqual([]);
  });

  it('焚毁摘掉等级最低的祝福', () => {
    gameState.equippedBoons = [
      { id: 'b1', name: '甲', slot: 'core', level: 2 },
      { id: 'b2', name: '乙', slot: 'boots', level: 0 }
    ];
    applyOutcome({ flags: ['burned-boon'] });
    expect(gameState.equippedBoons.map((b) => b.name)).toEqual(['甲']);
  });

  it('借贷当场 +60 券，同时典当一件装备（卖的是最后一件）', () => {
    gameState.carriedGear = ['armor-plate', 'core-platinum'];
    applyOutcome({ coupons: 60, flags: ['debt-carry'] });
    expect(gameState.coupons).toBe(60);
    expect(gameState.carriedGear).toEqual(['armor-plate']);
  });

  it('以身试药给本局伤害加成，样本盗窃给敌人血量倍率', () => {
    expect(applyOutcome({ flags: ['trial-buff'] }).runDamageBonus).toBeCloseTo(0.12, 6);
    expect(applyOutcome({ nextCombatHpMult: 1.15 }).nextCombatHpMult).toBeCloseTo(1.15, 6);
  });
});

describe('选项门槛在局内状态下的真实表现', () => {
  it('身上没装备时「卖」不可选', () => {
    const opt = getEvent('ev-scrap-deal')!.options[0];
    gameState.carriedGear = [];
    expect(optionAvailable(opt, ctx())).toBe(false);
    gameState.carriedGear = ['armor-plate'];
    expect(optionAvailable(opt, ctx())).toBe(true);
  });

  it('身上没祝福时「焚毁」不可选', () => {
    const opt = getEvent('ev-burn-notes')!.options[0];
    gameState.equippedBoons = [];
    expect(optionAvailable(opt, ctx())).toBe(false);
  });

  it('券不够时「买染料」不可选，且局内券不影响样本', () => {
    const opt = getEvent('ev-dye-broker')!.options[0];
    gameState.coupons = 10;
    gameState.samples = 999;
    expect(optionAvailable(opt, ctx())).toBe(false);
    gameState.coupons = 30;
    expect(optionAvailable(opt, ctx())).toBe(true);
    // 局内券与携带样本是两套账，买染料不动样本
    expect(gameState.samples).toBe(999);
  });

  it('EHP 档位决定「徒手取样」是否可选', () => {
    const opt = getEvent('ev-unstable-sample')!.options[0];
    gameState.ehp = 31;
    expect(optionAvailable(opt, ctx())).toBe(true);
    gameState.ehp = 20;
    expect(optionAvailable(opt, ctx())).toBe(false);
  });
});

describe('once 事件不会在一局里重复出现', () => {
  it('seen 记录后被 availableEvents 过滤', async () => {
    const { availableEvents } = await import('../src/game/data/events');
    gameState.seenEvents.push('ev-scrap-notes');
    expect(availableEvents(ctx()).some((d) => d.id === 'ev-scrap-notes')).toBe(false);
    gameState.seenEvents = [];
    expect(availableEvents(ctx()).some((d) => d.id === 'ev-scrap-notes')).toBe(true);
  });
});