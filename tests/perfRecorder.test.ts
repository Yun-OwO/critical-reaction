/**
 * 帧时间统计与自动调节的测试（T00）。
 *
 * 这里测的是**统计口径**，不是性能本身：低帧不能被平均值洗掉、
 * 设计内定格不能被删除、非交互区间必须排除、GPU 拿不到就必须是 null。
 */

import { describe, expect, it } from 'vitest';
import {
  FrameBudgetController,
  FrameRecorder,
  computeCpuStats,
  computeLow,
  computeStats,
  percentile,
  type FrameSample
} from '../src/game/perf/PerfRecorder';
import { FRAME_BUDGET } from '../src/game/visual/renderProfile';

const OPTS = { missedVsyncMs: FRAME_BUDGET.missedVsyncMs, hitchMs: FRAME_BUDGET.hitchMs };
const sample = (frameMs: number, over: Partial<FrameSample> = {}): FrameSample => ({
  frameMs, cpuMs: 5, hitStop: false, inactive: false, ...over
});

describe('T00 分位数与 low%', () => {
  it('percentile 线性插值', () => {
    const a = [1, 2, 3, 4, 5];
    expect(percentile(a, 0)).toBe(1);
    expect(percentile(a, 1)).toBe(5);
    expect(percentile(a, 0.5)).toBe(3);
    expect(percentile(a, 0.25)).toBe(2);
  });

  it('percentile 空数组返回 0', () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it('computeLow 取最慢 k 比例的均值再取倒数', () => {
    // 100 帧：90 帧 16.67ms + 10 帧 100ms
    const arr = [...Array(90).fill(16.67), ...Array(10).fill(100)].sort((a, b) => a - b);
    const low1 = computeLow(arr, 0.01);
    // 最慢 1% = 1 帧 = 100ms → 10fps
    expect(low1).toBeCloseTo(10, 1);
  });

  it('computeLow 与「取分位数再倒数」不同（不能混用）', () => {
    // 99 帧正常 + 1 帧长帧：low1 只看最慢 1 帧，p99 是插值分位数
    const arr = [...Array(99).fill(16.67), 50].sort((a, b) => a - b);
    const low1 = computeLow(arr, 0.01);           // 最慢 1% 均值倒数 = 1000/50 = 20
    const p99 = percentile(arr, 0.99);             // 插值分位数 ≈ 17
    expect(low1).toBeCloseTo(20, 1);
    expect(1000 / p99).toBeGreaterThan(50);
    expect(low1).not.toBeCloseTo(1000 / p99, 1);
  });

  it('computeLow 空输入为 0', () => {
    expect(computeLow([], 0.01)).toBe(0);
  });
});

describe('T00 统计口径', () => {
  it('稳态 60fps 的分位数正确', () => {
    const s = computeStats(Array.from({ length: 600 }, () => sample(16.67)), OPTS);
    expect(s.fps).toBeCloseTo(60, 0);
    expect(s.p99).toBeCloseTo(16.67, 1);
    expect(s.missedVsync).toBe(0);
    expect(s.hitches).toBe(0);
    expect(s.low01).toBeCloseTo(60, 0);
  });

  it('平均值不能洗掉坏帧：1% 长帧必须体现在 low1', () => {
    // 594 帧正常 + 6 帧 100ms（1% 坏帧）
    const s = computeStats(
      [...Array(594).fill(16.67), ...Array(6).fill(100)].map((v) => sample(v)),
      OPTS
    );
    expect(s.fps).toBeGreaterThan(55);        // 平均 FPS 看着还行
    expect(s.avgMs).toBeLessThan(18);
    expect(s.low1).toBeLessThan(12);          // 但 low1 暴露了问题
    expect(s.low01).toBeLessThan(12);
    expect(s.hitches).toBe(6);
  });

  it('missedVsync 与 hitch 分开统计', () => {
    // 26/28ms：错过一次刷新(>25ms)但未到卡顿线(33.3ms)
    const s = computeStats(
      [...Array(100).fill(16.67), sample(26), sample(28)],
      OPTS
    );
    expect(s.missedVsync).toBe(2);
    expect(s.hitches).toBe(0);
  });

  it('超过卡顿线的帧才计入 hitch', () => {
    const s = computeStats(
      [...Array(100).fill(16.67), sample(40)],
      OPTS
    );
    expect(s.missedVsync).toBe(1);
    expect(s.hitches).toBe(1);
  });

  it('命中定格计入统计并单独标注（不删除样本）', () => {
    const s = computeStats(
      [...Array(100).fill(16.67), sample(40, { hitStop: true })],
      OPTS
    );
    expect(s.hitStopFrames).toBe(1);
    expect(s.hitches).toBe(1);       // 仍然算进卡顿数
    expect(s.activeCount).toBe(101);
  });

  it('非交互区间被排除在验收统计外', () => {
    const s = computeStats(
      [...Array(100).fill(16.67).map((v) => sample(v)), sample(500, { inactive: true })],
      OPTS
    );
    expect(s.activeCount).toBe(100);
    expect(s.maxMs).toBeCloseTo(16.67, 1);   // 500ms 那帧不算
    expect(s.count).toBe(101);                 // 但样本总数仍如实记录
  });

  it('空输入返回全零而非 NaN', () => {
    const s = computeStats([], OPTS);
    expect(s.count).toBe(0);
    expect(s.avgMs).toBe(0);
    expect(s.fps).toBe(0);
    expect(s.maxMs).toBe(0);
    expect(s.gpuMs).toBeNull();
  });

  it('GPU 耗时无计时来源时必须是 null，不可用 0 或 CPU 代替', () => {
    const s = computeStats([sample(16.67)], OPTS);
    expect(s.gpuMs).toBeNull();
  });
});

describe('T00 CPU 段统计', () => {
  it('正确统计 CPU 分位数', () => {
    const cpu = computeCpuStats(
      [...Array(95).fill(4), ...Array(5).fill(12)].map((c) => sample(16.67, { cpuMs: c }))
    );
    expect(cpu).not.toBeNull();
    expect(cpu!.avgMs).toBeGreaterThan(4);
    expect(cpu!.p95).toBeGreaterThanOrEqual(4);
    expect(cpu!.maxMs).toBe(12);
  });

  it('无 CPU 样本返回 null', () => {
    expect(computeCpuStats([sample(16.67, { cpuMs: null })])).toBeNull();
    expect(computeCpuStats([])).toBeNull();
  });

  it('排除非交互区间的 CPU 样本', () => {
    const cpu = computeCpuStats([
      sample(16.67, { cpuMs: 5 }),
      sample(999, { cpuMs: 500, inactive: true })
    ]);
    expect(cpu!.maxMs).toBe(5);
  });
});

describe('T00 环形采样器', () => {
  it('首帧不产生样本', () => {
    const r = new FrameRecorder();
    r.push(1000, 5, false, false);
    expect(r.size).toBe(0);
    r.push(1016.67, 5, false, false);
    expect(r.size).toBe(1);
  });

  it('容量上限生效，按时间顺序导出', () => {
    const r = new FrameRecorder(4);
    let t = 0;
    for (let i = 0; i < 10; i += 1) {
      r.push((t += 16.67), 5, false, false);
    }
    expect(r.size).toBe(4);
    const s = r.samples();
    expect(s).toHaveLength(4);
    expect(s.every((x) => x.frameMs > 16 && x.frameMs < 17)).toBe(true);
  });

  it('超过 1000ms 的间隔被丢弃（切场景/后台不误判为卡顿）', () => {
    const r = new FrameRecorder();
    r.push(1000, 5, false, false);
    r.push(1016, 5, false, false);
    r.push(1016 + 2000, 5, false, false);   // 巨大间隔
    expect(r.size).toBe(1);
  });

  it('reset 归零', () => {
    const r = new FrameRecorder();
    r.push(1000, 5, false, false);
    r.push(1016, 5, false, false);
    expect(r.size).toBe(1);
    r.reset();
    expect(r.size).toBe(0);
  });

  it('stats 能带出外部测得的 GPU 耗时', () => {
    const r = new FrameRecorder();
    r.push(0, 5, false, false);
    r.push(16.67, 5, false, false);
    expect(r.stats(OPTS).gpuMs).toBeNull();
    expect(r.stats(OPTS, 7.5).gpuMs).toBe(7.5);
  });
});

describe('T00 自动调节控制器', () => {
  const opts = { windowMs: 100, tightenWindows: 2, recoverWindows: 5, overMs: 10, underMs: 7, step: 0.25 };

  it('单帧毛刺不触发收紧', () => {
    const c = new FrameBudgetController(opts);
    expect(c.sample(50)).toBe('hold');
    expect(c.load).toBe(0);
  });

  it('连续超线才收紧', () => {
    const c = new FrameBudgetController(opts);
    // windowMs=100、每帧 20ms → 一窗 5 帧
    const feed = (windows: number) => {
      let out: string | null = null;
      for (let w = 0; w < windows; w += 1) {
        for (let i = 0; i < 5; i += 1) out = c.sample(20);
      }
      return out;
    };
    expect(feed(1)).toBe('hold');   // 第 1 窗：bad=1，未达 tightenWindows=2
    expect(feed(1)).toBe('tighten'); // 第 2 窗：bad=2 → 收紧
    expect(c.load).toBeGreaterThan(0);
  });

  it('恢复比收紧迟钝得多', () => {
    const c = new FrameBudgetController(opts);
    const feed = (ms: number, windows: number) => {
      let out: string | null = null;
      // windowMs=100，每帧 ms，故一窗需要 100/ms 帧
      const perWindow = Math.ceil(opts.windowMs / ms);
      for (let w = 0; w < windows; w += 1) {
        for (let i = 0; i < perWindow; i += 1) out = c.sample(ms);
      }
      return out;
    };
    feed(20, 3); // 收紧若干次
    expect(c.load).toBeGreaterThan(0);
    // 恢复需要 5 窗；一次喂 5 窗应当恰好触发
    expect(feed(3, 5)).toBe('recover');
    expect(c.load).toBeLessThan(1);
  });

  it('成本线之间保持不动（迟滞带）', () => {
    const c = new FrameBudgetController(opts);
    for (let i = 0; i < 40; i += 1) c.sample(8);  // 8ms 在 7~10 之间
    expect(c.load).toBe(0);
  });

  it('强度被钳制在 0..1', () => {
    const c = new FrameBudgetController({ ...opts, step: 0.5 });
    // windowMs=100：50ms/帧 → 2 帧一窗；1ms/帧 → 100 帧一窗
    for (let i = 0; i < 400; i += 1) c.sample(50);
    expect(c.load).toBe(1);
    for (let i = 0; i < 2000; i += 1) c.sample(1);
    expect(c.load).toBe(0);
  });

  it('非法输入不改变状态', () => {
    const c = new FrameBudgetController(opts);
    expect(c.sample(Number.NaN)).toBe('hold');
    expect(c.sample(0)).toBe('hold');
    expect(c.sample(-5)).toBe('hold');
    expect(c.load).toBe(0);
  });

  it('reset 清空收紧状态', () => {
    const c = new FrameBudgetController(opts);
    for (let i = 0; i < 60; i += 1) c.sample(50);
    c.reset();
    expect(c.load).toBe(0);
  });
});