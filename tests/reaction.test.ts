import { describe, expect, it } from 'vitest';
import {
  addLayers,
  claimMilestones,
  isRunawayCancel,
  reactionDamageMult,
  type LayerMilestone
} from '../src/game/combat/reaction';
import { battlePower, equivalentSwap, buildComposition, COMBAT_POOL } from '../src/game/data/rooms';
import { sampleDisabledBoons, BOON_POOL } from '../src/game/data/upgrades';

describe('反应催化层数（卫戍协议 bonds 层系统）', () => {
  it('层数累计：负增益忽略，999 硬上限封顶', () => {
    expect(addLayers(10, 5, 999)).toBe(15);
    expect(addLayers(10, -3, 999)).toBe(10);
    expect(addLayers(0, 0, 999)).toBe(0);
    expect(addLayers(995, 10, 999)).toBe(999);
  });

  it('里程碑按序领取：层数只增不减，大额增长跨越多个里程碑', () => {
    const ms: readonly LayerMilestone[] = [
      { at: 25, reward: 'samples', amount: 10, label: 'a' },
      { at: 50, reward: 'electron', amount: 1, label: 'b' },
      { at: 100, reward: 'cool', amount: 30, label: 'c' }
    ];
    // 未达首个
    expect(claimMilestones(10, 0, ms).rewards).toHaveLength(0);
    // 恰好达到首个
    expect(claimMilestones(25, 0, ms).rewards).toHaveLength(1);
    // 一次跨两个
    const jump = claimMilestones(60, 0, ms);
    expect(jump.claimedCount).toBe(2);
    expect(jump.rewards.map((m) => m.label)).toEqual(['a', 'b']);
    // 已领进度单调：重查不重复领取
    expect(claimMilestones(60, jump.claimedCount, ms).rewards).toHaveLength(0);
  });

  it('层数伤害倍率：线性 + 里程碑加成，负值钳为 0', () => {
    expect(reactionDamageMult(0, 0.002, 0)).toBe(1);
    expect(reactionDamageMult(100, 0.002, 0)).toBeCloseTo(1.2, 6);
    expect(reactionDamageMult(100, 0.002, 0.1)).toBeCloseTo(1.3, 6);
    expect(reactionDamageMult(-5, 0.002, 0)).toBe(1);
  });
});

describe('失控取消（卫戍协议「取消而非截断」）', () => {
  const rule = { threshold: 7, fullRatio: 0.8 };
  const CAP = 8;

  it('单发超限 + 目标满仓 → 取消', () => {
    expect(isRunawayCancel(7, 8, CAP, rule)).toBe(true);
    expect(isRunawayCancel(10, 8, CAP, rule)).toBe(true);
  });

  it('储备不足 80% 时反应有缓冲空间，不取消', () => {
    expect(isRunawayCancel(7, 6, CAP, rule)).toBe(false);
    expect(isRunawayCancel(7, 8 * 0.8 - 0.01, CAP, rule)).toBe(false);
  });

  it('未超阈值的单发永不取消', () => {
    expect(isRunawayCancel(6, 8, CAP, rule)).toBe(false);
  });

  it('零容量目标不触发', () => {
    expect(isRunawayCancel(10, 0, 0, rule)).toBe(false);
  });
});

describe('波次战力等价替换（卫戍协议「换怪不换难度」）', () => {
  it('战力公式：HP × 行为威胁系数', () => {
    const chaser = COMBAT_POOL.find((d) => d.kind === 'chaser')!;
    const healer = COMBAT_POOL.find((d) => d.kind === 'healer')!;
    expect(battlePower(chaser)).toBeCloseTo(chaser.baseHp * 1.0, 6);
    expect(battlePower(healer)).toBeCloseTo(healer.baseHp * 1.3, 6);
  });

  it('等价替换：结果在容差内且 key 不同；无候选时原样返回', () => {
    const pick = COMBAT_POOL.find((d) => d.key === 'oxidizer')!; // BE 55×1.2=66
    const rng = () => 0; // 恒选第一个候选
    for (let i = 0; i < 20; i++) {
      const swapped = equivalentSwap(pick, COMBAT_POOL, rng, 0.25);
      expect(swapped.key).not.toBe('oxidizer');
      const base = battlePower(pick);
      expect(Math.abs(battlePower(swapped) - base)).toBeLessThanOrEqual(base * 0.25 + 1e-6);
    }
    // 池中只有一个成员时无候选 → 原样
    const lone = COMBAT_POOL.filter((d) => d.key === 'polymer');
    expect(equivalentSwap(lone[0], lone, rng, 0.25)).toBe(lone[0]);
  });

  it('buildComposition：swapChance 只作用于加权位，保底三件套不动', () => {
    const cfg = { count: 6, composition: COMBAT_POOL };
    const roster = buildComposition(cfg, 6, Math.random, 1.0); // 必然尝试替换
    expect(roster).toHaveLength(6);
    // 保底三件套：前三个必须是 chaser/ranged/tank（COMBAT_POOL 前三项）
    expect(roster[0].key).toBe(COMBAT_POOL[0].key);
    expect(roster[1].key).toBe(COMBAT_POOL[1].key);
    expect(roster[2].key).toBe(COMBAT_POOL[2].key);
    // 全部成员都来自合法池
    for (const def of roster) {
      expect(COMBAT_POOL.some((d) => d.key === def.key)).toBe(true);
    }
  });
});

describe('每局随机禁用祝福', () => {
  it('返回不重复的祝福 id，数量不超过请求数', () => {
    const disabled = sampleDisabledBoons(BOON_POOL, 2);
    expect(disabled).toHaveLength(2);
    expect(new Set(disabled).size).toBe(2);
    for (const id of disabled) {
      expect(BOON_POOL.some((b) => b.id === id)).toBe(true);
    }
  });

  it('请求数超过池子时返回全量', () => {
    expect(sampleDisabledBoons(BOON_POOL, 999).length).toBe(new Set(BOON_POOL.map((b) => b.id)).size);
  });

  it('rng 可注入保证确定性', () => {
    let seed = 42;
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const a = sampleDisabledBoons(BOON_POOL, 2, rng);
    seed = 42;
    const b = sampleDisabledBoons(BOON_POOL, 2, rng);
    expect(a).toEqual(b);
  });
});
