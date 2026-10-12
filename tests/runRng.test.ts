import { describe, expect, it } from 'vitest';
import { mulberry32, RunRng } from '../src/game/utils/RunRng';

describe('mulberry32', () => {
  it('同种子产出完全相同的序列', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i += 1) {
      expect(a()).toBe(b());
    }
  });

  it('不同种子产出不同序列', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('输出落在 [0,1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('RunRng', () => {
  it('同种子完全可复现（联机/回放的根基）', () => {
    const a = new RunRng(12345);
    const b = new RunRng(12345);
    for (let i = 0; i < 50; i += 1) {
      expect(a.between(1, 100)).toBe(b.between(1, 100));
      expect(a.float()).toBe(b.float());
      expect(a.chance(0.5)).toBe(b.chance(0.5));
    }
  });

  it('reseed 重置序列', () => {
    const rng = new RunRng(1);
    const first = rng.between(1, 1000);
    rng.reseed(1);
    expect(rng.between(1, 1000)).toBe(first);
  });

  it('between：闭区间、单点区间、反向区间安全', () => {
    const rng = new RunRng(9);
    for (let i = 0; i < 200; i += 1) {
      const v = rng.between(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
    }
    expect(rng.between(5, 5)).toBe(5);
    expect(rng.between(7, 3)).toBe(7); // 反向不抛错，返回下界（与 Phaser.Math.Between 的 clamp 语义对齐）
  });

  it('between 能取到两个端点（不是半开区间）', () => {
    // 与 Phaser.Math.Between 同签名，端点必须可达，否则迁移后行为悄悄变了
    const rng = new RunRng(314);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) seen.add(rng.between(1, 3));
    expect(seen.has(1)).toBe(true);
    expect(seen.has(3)).toBe(true);
  });

  it('chance：0 恒假、1 恒真', () => {
    const rng = new RunRng(11);
    for (let i = 0; i < 20; i += 1) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it('pick：空数组安全、单元素恒定', () => {
    const rng = new RunRng(2);
    expect(rng.pick([])).toBeUndefined();
    expect(rng.pick(['x'])).toBe('x');
  });

  it('shuffle：保留全部元素（是置换不是抽样）', () => {
    const rng = new RunRng(5);
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = rng.shuffle([...src]);
    expect([...out].sort()).toEqual(src);
  });

  it('weightedPick：权重 0 的项不会被抽中', () => {
    const rng = new RunRng(77);
    const items = [
      { id: 'a', weight: 0 },
      { id: 'b', weight: 1 }
    ];
    for (let i = 0; i < 50; i += 1) {
      expect(rng.weightedPick(items)!.id).toBe('b');
    }
  });

  it('weightedPick：全 0 权重回退为均匀', () => {
    const rng = new RunRng(13);
    const items = [
      { id: 'a', weight: 0 },
      { id: 'b', weight: 0 }
    ];
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) seen.add(rng.weightedPick(items)!.id);
    expect(seen.size).toBe(2);
  });

  it('real：开区间语义', () => {
    const rng = new RunRng(6);
    for (let i = 0; i < 100; i += 1) {
      const v = rng.real(1, 2);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThan(2);
    }
  });

  it('未给种子时也能工作（单机行为不变）', () => {
    const rng = new RunRng();
    for (let i = 0; i < 20; i += 1) {
      const v = rng.float();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('大种子（负数/超 32 位）不产生异常序列', () => {
    const a = new RunRng(-1);
    const b = new RunRng(4294967296 + 7);
    expect(Number.isFinite(a.float())).toBe(true);
    expect(Number.isFinite(b.float())).toBe(true);
  });
});