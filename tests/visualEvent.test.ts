/**
 * T02 表现事件契约、时钟分离、表现 RNG 与渲染档位的测试。
 */

import { describe, expect, it } from 'vitest';
import {
  DualClock,
  FxRng,
  VisualEventGate,
  defaultImportanceFor,
  defaultTierFor,
  makeVisualEvent,
  sacrificeOrder,
  type VisualEvent
} from '../src/game/visual/visualEvent';
import {
  AUTO_TUNE,
  FRAME_BUDGET,
  READABILITY,
  RENDER_PROFILES,
  TIER_BUDGETS,
  computeAllowance,
  getRenderProfile,
  mayEmit,
  setRenderPreset,
  withinCriticalReserve
} from '../src/game/visual/renderProfile';
import { RunRng } from '../src/game/utils/RunRng';

const draft = (over: Partial<Parameters<typeof makeVisualEvent>[0]> = {}): Parameters<typeof makeVisualEvent>[0] => ({
  eventId: 'e1',
  entityId: 'player',
  runId: 'run1',
  roomId: 'room1',
  kind: 'player.melee.basic',
  phase: 'hit',
  world: { x: 100, z: 200, height: 0 },
  direction: 1.57,
  mode: 'oxidized',
  intensity: 1,
  startTime: 10,
  duration: 0.2,
  ...over
});

describe('T02 事件默认值', () => {
  it('每个 kind 都有档位与重要性（无 undefined 泄漏）', () => {
    const kinds = [
      'player.melee.basic',
      'player.cannon.basic',
      'player.charge.loop',
      'player.melee.special',
      'player.cannon.special',
      'player.dash',
      'player.mode.change',
      'player.hurt',
      'boss.slam',
      'boss.aoe',
      'boss.shot',
      'boss.phase',
      'boss.defeat',
      'boss.titration.acid',
      'boss.electrolysis.beam',
      'boss.chain.bomb',
      'boss.oxidation.smoke',
      'world.enemy.death',
      'world.electron.transfer',
      'world.pickup',
      'world.hazard'
    ] as const;
    for (const k of kinds) {
      expect(defaultTierFor(k), k).toMatch(/^G[0-3]$/);
      expect(['critical', 'important', 'normal', 'cosmetic']).toContain(defaultImportanceFor(k));
    }
  });

  it('玩家受伤与 Boss 转阶段是 critical；蓄力是 cosmetic', () => {
    expect(defaultImportanceFor('player.hurt')).toBe('critical');
    expect(defaultImportanceFor('boss.phase')).toBe('critical');
    expect(defaultImportanceFor('player.charge.loop')).toBe('cosmetic');
  });

  it('两种特殊攻击都是 G2（规格 §D2 要求大范围华丽）', () => {
    expect(defaultTierFor('player.melee.special')).toBe('G2');
    expect(defaultTierFor('player.cannon.special')).toBe('G2');
  });

  it('牺牲顺序：critical 最后被砍', () => {
    expect(sacrificeOrder('cosmetic')).toBeLessThan(sacrificeOrder('normal'));
    expect(sacrificeOrder('normal')).toBeLessThan(sacrificeOrder('important'));
    expect(sacrificeOrder('important')).toBeLessThan(sacrificeOrder('critical'));
  });

  it('makeVisualEvent 补齐默认值且不覆盖显式值', () => {
    const e = makeVisualEvent(draft());
    expect(e.tier).toBe('G0');
    expect(e.importance).toBe('normal');
    const explicit = makeVisualEvent(draft({ kind: 'boss.slam', tier: 'G1', importance: 'cosmetic' }));
    expect(explicit.tier).toBe('G1');
    expect(explicit.importance).toBe('cosmetic');
  });
});

describe('T02 事件收口', () => {
  it('同一 eventId 只接受一次', () => {
    const gate = new VisualEventGate();
    const e = makeVisualEvent(draft());
    expect(gate.accept(e)).toBe(true);
    expect(gate.accept(e)).toBe(false);
    expect(gate.size).toBe(1);
  });

  it('换房取消该房间事件，保留其它房间', () => {
    const gate = new VisualEventGate();
    const active: VisualEvent[] = [
      makeVisualEvent(draft({ eventId: 'a', roomId: 'r1' })),
      makeVisualEvent(draft({ eventId: 'b', roomId: 'r2' })),
      makeVisualEvent(draft({ eventId: 'c', roomId: 'r1' }))
    ];
    const left = gate.cancelRoom('r1', active);
    expect(left.map((e) => e.eventId)).toEqual(['b']);
  });

  it('seen 集合有上界，长局不无限增长', () => {
    const gate = new VisualEventGate(8);
    for (let i = 0; i < 100; i += 1) {
      gate.accept(makeVisualEvent(draft({ eventId: `x${i}` })));
    }
    expect(gate.size).toBe(8);
  });

  it('超出上界后旧 id 可被再次接受（不会永久误杀）', () => {
    const gate = new VisualEventGate(4);
    for (let i = 0; i < 4; i += 1) gate.accept(makeVisualEvent(draft({ eventId: 'keep' })));
    for (let i = 0; i < 10; i += 1) gate.accept(makeVisualEvent(draft({ eventId: `f${i}` })));
    expect(gate.accept(makeVisualEvent(draft({ eventId: 'keep' })))).toBe(true);
  });

  it('reset 清空全部', () => {
    const gate = new VisualEventGate();
    gate.accept(makeVisualEvent(draft()));
    gate.reset();
    expect(gate.size).toBe(0);
    expect(gate.accept(makeVisualEvent(draft()))).toBe(true);
  });
});

describe('T02 时钟分离', () => {
  it('正常推进时两个时钟同步', () => {
    const c = new DualClock();
    c.advance(0.5);
    expect(c.sim).toBeCloseTo(0.5);
    expect(c.presentation).toBeCloseTo(0.5);
  });

  it('冻结时模拟停、表现继续（暂停/定格不冻结 UI 动效）', () => {
    const c = new DualClock();
    c.advance(0.2);
    c.freeze();
    c.advance(1);
    expect(c.sim).toBeCloseTo(0.2);
    expect(c.presentation).toBeCloseTo(1.2);
    c.resume();
    c.advance(0.3);
    expect(c.sim).toBeCloseTo(0.5);
  });

  it('非法 dt 被忽略，不产生 NaN', () => {
    const c = new DualClock();
    c.advance(Number.NaN);
    c.advance(-1);
    c.advance(0);
    expect(c.sim).toBe(0);
    expect(c.presentation).toBe(0);
  });

  it('freezeIf 条件冻结，避免忘记配对 resume', () => {
    const c = new DualClock();
    c.advance(0.1);
    c.freezeIf(true);
    c.advance(0.5);
    expect(c.sim).toBeCloseTo(0.1);
    expect(c.presentation).toBeCloseTo(0.6);
    c.freezeIf(false);
    c.advance(0.4);
    expect(c.sim).toBeCloseTo(0.5);
    c.freezeIf(true);
    c.freezeIf(false);
    c.freezeIf(true);
    expect(c.isFrozen).toBe(true);
  });

  it('reset 归零两个时钟并解冻', () => {
    const c = new DualClock();
    c.advance(2);
    c.freeze();
    c.reset();
    expect(c.sim).toBe(0);
    expect(c.presentation).toBe(0);
    expect(c.isFrozen).toBe(false);
  });
});

describe('T02 表现 RNG 与战斗 RNG 隔离', () => {
  it('同种子可复现', () => {
    const a = new FxRng(12345);
    const b = new FxRng(12345);
    for (let i = 0; i < 50; i += 1) expect(a.float()).toBe(b.float());
  });

  it('不同种子产生不同序列', () => {
    const a = new FxRng(1);
    const b = new FxRng(2);
    const seqA = Array.from({ length: 20 }, () => a.float());
    const seqB = Array.from({ length: 20 }, () => b.float());
    expect(seqA).not.toEqual(seqB);
  });

  it('消耗表现 RNG 不影响战斗 RNG 序列', () => {
    const combatA = new RunRng(777);
    const combatB = new RunRng(777);
    const fx = new FxRng(999);
    // 只在 B 侧消耗表现随机（模拟「开关特效」）
    for (let i = 0; i < 500; i += 1) fx.float();
    const seqA = Array.from({ length: 50 }, () => combatA.float());
    const seqB = Array.from({ length: 50 }, () => combatB.float());
    expect(seqA).toEqual(seqB);
  });

  it('float 落在 [0,1)', () => {
    const fx = new FxRng(42);
    for (let i = 0; i < 2000; i += 1) {
      const v = fx.float();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('between 是闭区间整数，real 是半开区间', () => {
    const fx = new FxRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 3000; i += 1) {
      const v = fx.between(3, 5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5]);
    for (let i = 0; i < 500; i += 1) {
      const r = fx.real(1, 2);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThan(2);
    }
  });

  it('种子 0 不退化为恒 0', () => {
    const fx = new FxRng(0);
    const vals = new Set(Array.from({ length: 20 }, () => fx.float()));
    expect(vals.size).toBeGreaterThan(1);
  });

  it('reseed 后序列从新种子重新开始', () => {
    const fx = new FxRng(1);
    fx.float();
    fx.reseed(1);
    const g = new FxRng(1);
    expect(fx.float()).toBe(g.float());
  });
});

describe('T02 渲染档位', () => {
  it('三档 renderScale 都是 1（不得自动降主分辨率）', () => {
    for (const p of Object.values(RENDER_PROFILES)) expect(p.renderScale).toBe(1);
  });

  it('档位按预算单调递增', () => {
    const [perf, bal, fine] = [RENDER_PROFILES.performance, RENDER_PROFILES.balanced, RENDER_PROFILES.fine];
    expect(perf.maxParticles).toBeLessThan(bal.maxParticles);
    expect(bal.maxParticles).toBeLessThan(fine.maxParticles);
    expect(perf.ssrSteps).toBeLessThanOrEqual(bal.ssrSteps);
    expect(bal.ssrSteps).toBeLessThanOrEqual(fine.ssrSteps);
    expect(perf.maxDynamicLights).toBeLessThan(fine.maxDynamicLights);
  });

  it('环境额度 + 关键保留 ≤ 粒子上限（预算自洽）', () => {
    for (const p of Object.values(RENDER_PROFILES)) {
      expect(p.ambientParticleQuota + p.criticalReserve).toBeLessThanOrEqual(p.maxParticles);
    }
  });

  it('RT 预算随档位递增', () => {
    expect(RENDER_PROFILES.performance.rtBudgetMiB).toBeLessThan(RENDER_PROFILES.fine.rtBudgetMiB);
  });

  it('getRenderProfile 跟随当前档位', () => {
    const before = getRenderProfile().id;
    setRenderPreset('fine');
    expect(getRenderProfile().id).toBe('fine');
    setRenderPreset('performance');
    expect(getRenderProfile().id).toBe('performance');
    setRenderPreset(before as never);
  });

  it('withinCriticalReserve 判定正确', () => {
    const p = RENDER_PROFILES.performance;
    expect(withinCriticalReserve(p.criticalReserve, p)).toBe(true);
    expect(withinCriticalReserve(p.criticalReserve + 1, p)).toBe(false);
  });
});

describe('T02 演出档预算', () => {
  it('G2/G3 允许大范围但不放开到整屏', () => {
    expect(TIER_BUDGETS.G2.spanRatio).toBeGreaterThan(TIER_BUDGETS.G1.spanRatio);
    expect(TIER_BUDGETS.G3.spanRatio).toBeGreaterThan(TIER_BUDGETS.G2.spanRatio);
    for (const t of Object.values(TIER_BUDGETS)) {
      expect(t.spanRatio).toBeLessThan(2);
      expect(t.brightAreaRatio).toBeLessThanOrEqual(0.12);
    }
  });

  it('G0/G1 保持克制（不破坏层级）', () => {
    expect(TIER_BUDGETS.G0.brightAreaRatio).toBeLessThan(TIER_BUDGETS.G1.brightAreaRatio);
    expect(TIER_BUDGETS.G0.particles).toBeLessThan(TIER_BUDGETS.G1.particles);
  });

  it('可读性阈值符合规格 §D3', () => {
    expect(READABILITY.playerProtectPx).toBe(18);
    expect(READABILITY.playerProtectMaxAlpha).toBeLessThan(0.1);
    expect(READABILITY.maxConcurrentPeak).toBe(2);
  });
});

describe('T02 帧预算与自动调节', () => {
  it('帧预算常量自洽（60Hz）', () => {
    expect(FRAME_BUDGET.targetFps).toBe(60);
    expect(FRAME_BUDGET.frameMs).toBeCloseTo(16.667, 2);
    expect(FRAME_BUDGET.cpuP95Ms).toBeLessThan(FRAME_BUDGET.gpuP95Ms);
    expect(FRAME_BUDGET.missedVsyncMs).toBeGreaterThan(FRAME_BUDGET.frameMs);
    expect(FRAME_BUDGET.hitchMs).toBeGreaterThan(FRAME_BUDGET.missedVsyncMs);
  });

  it('自动调节是「先收紧后恢复」且恢复更迟钝', () => {
    expect(AUTO_TUNE.tightenWindows).toBeLessThan(AUTO_TUNE.recoverWindows);
    expect(AUTO_TUNE.recoverCpuMs).toBeLessThan(AUTO_TUNE.tightenCpuMs);
    expect(AUTO_TUNE.recoverGpuMs).toBeLessThan(AUTO_TUNE.tightenGpuMs);
  });

  it('allowance 随强度单调下降，关键反馈始终完整', () => {
    const a0 = computeAllowance(RENDER_PROFILES.balanced, 0);
    const a05 = computeAllowance(RENDER_PROFILES.balanced, 0.5);
    const a1 = computeAllowance(RENDER_PROFILES.balanced, 1);
    expect(a0.ambient).toBe(1);
    expect(a05.ambient).toBeLessThan(a0.ambient);
    expect(a1.ambient).toBe(0);
    for (const a of [a0, a05, a1]) expect(a.criticalIntact).toBe(true);
  });

  it('mayEmit：critical/important 在任何收紧程度下都保留', () => {
    for (const i of [0, 0.5, 1]) {
      expect(mayEmit('critical', i)).toBe(true);
      expect(mayEmit('important', i)).toBe(true);
    }
  });

  it('mayEmit：cosmic 在满收紧时停止', () => {
    expect(mayEmit('cosmetic', 0)).toBe(true);
    expect(mayEmit('cosmetic', 1)).toBe(false);
  });

  it('intensity 被钳制在 0..1', () => {
    expect(computeAllowance(RENDER_PROFILES.balanced, -5).ambient).toBe(1);
    expect(computeAllowance(RENDER_PROFILES.balanced, 5).ambient).toBe(0);
  });
});