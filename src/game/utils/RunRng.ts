/**
 * 局内随机数收口（联机接缝 1）
 *
 * 现状：地形生成已经是种子确定性（biomes.ts 的 mulberry32 + runSeed），
 * 但战斗层有 91 处直接用 `Math.random()` / `Phaser.Math.Between`——
 * 同一 seed 复现不了同一局，联机/回放/崩溃复现全都无从谈起。
 *
 * 这是「联机接缝」里的第一条（见 docs/roadmap-v2.md §八）：
 * **所有局内随机都要走一个可播种的 Rng 接口**。单机时它就是 Math.random
 * 的薄包装（零行为变化）；将来联机时换成「服务器 seed + 帧号」的确定性流，
 * 游戏代码一行不用改。
 *
 * 设计取舍：
 * - 用**类**而不是函数集：Rng 需要可替换（单机/联机两种实现），
 *   且战斗代码里大量 `Phaser.Math.Between(a,b)` 的调用点，提供同签名的
 *   `between()` 能让迁移成本接近零；
 * - 不做流的 fork/join（子流、每敌人独立流）——那是联机真正接入时才需要
 *   的复杂度，现在做是过度设计。一个可播种的线性流已满足「可复现」。
 */

/** 可播种的随机源接口。单机实现是 mulberry32，联机实现将换成服务器驱动。 */
export interface RngSource {
  /** [0,1) 浮点 */
  (): number;
}

export class RunRng {
  private next: RngSource;

  constructor(seed?: number) {
    this.next = mulberry32(seed ?? ((Math.random() * 0xffffffff) >>> 0));
  }

  /** 重新播种（新一局开始时）。 */
  reseed(seed: number): void {
    this.next = mulberry32(seed);
  }

  /** [0,1) 浮点，等价于 Math.random()。 */
  float(): number {
    return this.next();
  }

  /** [min,max] 闭区间整数，等价于 Phaser.Math.Between(min,max)。 */
  between(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** [min,max) 浮点。 */
  real(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** 以 probability 的概率返回 true。 */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** 从数组均匀挑一个；空数组返回 undefined。 */
  pick<T>(arr: readonly T[]): T | undefined {
    if (arr.length === 0) return undefined;
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }

  /** 原地 Fisher-Yates 洗牌（返回同一引用，便于链式）。 */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** 带权抽取：items 里的 weight 字段为权重；全 0 或空时均匀。 */
  weightedPick<T extends { weight: number }>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (const item of items) {
      roll -= Math.max(0, item.weight);
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }
}

/** mulberry32：32 位种子的小而快的 PRNG（与 biomes.ts 同款，确定性有保证）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}