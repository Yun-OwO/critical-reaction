/**
 * 逸散光雾场（全局升级执行规格 T08 / §D1）
 *
 * 目标形态（对应 R09/R10）：
 *   - 大量微小自发光粒子构成柔和云雾；粒子重叠处亮度叠加，形成浓淡变化；
 *   - 边缘**完全透明**，无硬切边，无矩形裁剪；
 *   - 透明度随密度变化，而不是恒定 alpha；
 *   - 运动**不固定路径**，带随机成分但整体连贯（不是逐帧白噪声抖动）。
 *
 * 与既有 FxPool 的关系：
 *   FxPool 负责「屏幕上的清晰微粒」；本模块负责「这些微粒累积出的柔和云层」。
 *   两者**同源**——同一批微粒既画成可辨颗粒，也累积进低分辨率密度场，
 *   而不是再叠几张巨大的云雾 billboard（那正是规格禁止的做法）。
 *
 * 关键设计：
 *   1. 流场是**有 seed 的低频 value-noise**，用共享格点中心差分求涡度，
 *      所有粒子共用一次采样 → CPU 可承受；
 *   2. 场以 15Hz 重生成，按 dt 在两场之间平滑插值 → 连续而非跳变；
 *   3. 密度→不透明度用 `1 - exp(-k·D)`，是 Beer–Lambert 形式的浓度映射：
 *      叠加会饱和而不是线性爆掉，且永远到不了 1（不出现硬边白块）。
 *   4. 所有随机走 FxRng（独立种子），不碰战斗 RunRng。
 *
 * 本模块**不引用 Phaser**，可纯单测。
 */

import { FxRng } from '../visual/visualEvent';

export const FX_RNG_TAIL = 0; // 占位，避免误以为这里有共享状态

/** 网格常量（规格 §D1 INIT）。 */
export interface FlowFieldConfig {
  /** 场分辨率（每轴格点数） */
  size: number;
  /** 每格覆盖的世界单位 */
  cellSize: number;
  /** 场重生成频率（Hz） */
  regenHz: number;
  /** 涡旋加速度上限（世界单位/s²） */
  maxAccel: number;
  /** 浮升加速度（视觉高度方向，世界单位/s²） */
  buoyancy: number;
}

export const DEFAULT_FLOW: FlowFieldConfig = {
  size: 32,
  cellSize: 64,
  regenHz: 15,
  maxAccel: 60,
  buoyancy: 15
};

/** 带种子的 2D value-noise（连续、可复现、无需外部依赖）。 */
export class ValueNoise2D {
  private readonly perm: Uint16Array;

  public constructor(private readonly seed: number) {
    const p = new Uint16Array(512);
    const base = new Uint16Array(256);
    for (let i = 0; i < 256; i += 1) base[i] = i;
    // Fisher–Yates，用本地 mulberry32 变体保证可复现
    const rnd = mulberry32(seed >>> 0 || 1);
    for (let i = 255; i > 0; i -= 1) {
      const j = Math.floor(rnd() * (i + 1));
      const t = base[i];
      base[i] = base[j];
      base[j] = t;
    }
    for (let i = 0; i < 512; i += 1) p[i] = base[i & 255];
    this.perm = p;
  }

  private hash(x: number, y: number): number {
    return (this.perm[(this.perm[x & 255] + y) & 511] / 65535) * 2 - 1;
  }

  /** 双线性插值的 value-noise，返回大致 [-1, 1]。 */
  public sample(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = this.hash(xi, yi);
    const b = this.hash(xi + 1, yi);
    const c = this.hash(xi, yi + 1);
    const d = this.hash(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 共享流场。
 *
 * 一次生成被所有粒子复用；`sampleAccel()` 返回该点的涡旋加速度。
 */
export class FlowField {
  private noise: ValueNoise2D;
  private curX: Float32Array;
  private curY: Float32Array;
  private nxtX: Float32Array;
  private nxtY: Float32Array;
  private phase = 0;
  private phaseInc: number;
  private genAcc = 0;

  public constructor(
    readonly cfg: FlowFieldConfig = DEFAULT_FLOW,
    seed = 1337
  ) {
    this.noise = new ValueNoise2D(seed);
    const n = cfg.size * cfg.size;
    this.curX = new Float32Array(n);
    this.curY = new Float32Array(n);
    this.nxtX = new Float32Array(n);
    this.nxtY = new Float32Array(n);
    this.phaseInc = cfg.regenHz / 60;
    this.regenerate(this.curX, this.curY, 0);
    this.regenerate(this.nxtX, this.nxtY, 0);
  }

  /** 用 ψ 的旋度 (∂ψ/∂y, -∂ψ/∂x) 填场；中心差分取相邻格点。 */
  private regenerate(ax: Float32Array, ay: Float32Array, phase: number): void {
    const { size, cellSize } = this.cfg;
    const s = 1 / cellSize;
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const x = i * s;
        const y = j * s;
        // 中心差分
        const dpdy = (this.noise.sample(x, y + s) - this.noise.sample(x, y - s)) * 0.5;
        const dpdx = (this.noise.sample(x + s, y) - this.noise.sample(x - s, y)) * 0.5;
        // 旋度 = (∂ψ/∂y, -∂ψ/∂x)，限幅到单位长度
        let vx = dpdy;
        let vy = -dpdx;
        const mag = Math.hypot(vx, vy);
        if (mag > 1) {
          vx /= mag;
          vy /= mag;
        }
        // 轻微相位偏置：让相邻两场不完全相同，插值才不是原地踏步
        const m = 0.85 + 0.3 * Math.sin(phase + i * 0.21 + j * 0.17);
        const k = j * size + i;
        ax[k] = vx * m;
        ay[k] = vy * m;
      }
    }
  }

  /** 双线性采样 + 时间插值。 */
  public sampleAccel(x: number, y: number): { ax: number; ay: number } {
    const { size, cellSize, maxAccel } = this.cfg;
    const gx = x / cellSize;
    const gy = y / cellSize;
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gy);
    const fx = gx - i0;
    const fy = gy - j0;
    const idx = (i: number, j: number): number => {
      // 环绕采样：离开覆盖范围时用相邻周期，不在 tile 边突然翻向
      const ii = ((i % size) + size) % size;
      const jj = ((j % size) + size) % size;
      return jj * size + ii;
    };
    const lerp4 = (f: Float32Array): number => {
      const a = f[idx(i0, j0)];
      const b = f[idx(i0 + 1, j0)];
      const c = f[idx(i0, j0 + 1)];
      const d = f[idx(i0 + 1, j0 + 1)];
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    };
    const t = this.phase;
    const ax = lerp4(this.curX) * (1 - t) + lerp4(this.nxtX) * t;
    const ay = lerp4(this.curY) * (1 - t) + lerp4(this.nxtY) * t;
    const mag = Math.hypot(ax, ay);
    const scale = mag > maxAccel ? maxAccel / mag : 1;
    return { ax: ax * scale, ay: ay * scale };
  }

  public advance(dt: number): void {
    this.genAcc += dt;
    this.phaseInc = this.cfg.regenHz * dt;
    this.phase += this.phaseInc;
    if (this.genAcc >= 1 / this.cfg.regenHz) {
      this.genAcc = 0;
      const tx = this.curX; this.curX = this.nxtX; this.nxtX = tx;
      const ty = this.curY; this.curY = this.nxtY; this.nxtY = ty;
      this.regenerate(this.nxtX, this.nxtY, this.phase);
      this.phase = 0;
    }
  }

  public reseed(seed: number): void {
    this.noise = new ValueNoise2D(seed);
  }
}

/** 单颗微粒。 */
export interface VaporParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  tint: number;
}

/** 发射参数（对应规格 §D1 的分区 INIT 值）。 */
export interface EmitParams {
  count: number;
  /** 出生位置 */
  x: number;
  y: number;
  /** 发射方向（弧度） */
  angle: number;
  /** 方向扰动幅度（弧度） */
  spread: number;
  speedMin: number;
  speedMax: number;
  lifeMin: number;
  lifeMax: number;
  sizeMin: number;
  sizeMax: number;
  tint: number;
  /** 是否可被预算收紧削减 */
  cosmetic: boolean;
}

export const EMIT_PRESETS = {
  /** G0 普通命中 */
  g0: {
    count: 24, spread: 0.45, speedMin: 40, speedMax: 120,
    lifeMin: 0.25, lifeMax: 0.55, sizeMin: 1.5, sizeMax: 3.5
  },
  /** G2/G3 华丽余韵 */
  g2: {
    count: 180, spread: 0.9, speedMin: 80, speedMax: 220,
    lifeMin: 0.6, lifeMax: 1.1, sizeMin: 2, sizeMax: 5
  }
} as const;

/**
 * 光雾场：管理微粒运动与密度累积。
 *
 * 与 Phaser 无关——渲染层自行读取 `densityAt()` 上传低分辨率纹理，
 * 或直接把 `particles` 画成精灵。
 */
export class VaporField {
  public readonly particles: VaporParticle[] = [];
  private readonly free: VaporParticle[] = [];
  private rng: FxRng;
  private baseCap = 800;

  public constructor(
    public readonly flow: FlowField = new FlowField(),
    seed = 0x5eed1e
  ) {
    this.rng = new FxRng(seed);
  }

  public setBudget(cap: number): void {
    this.baseCap = Math.max(1, cap);
  }

  public reseed(seed: number): void {
    this.rng.reseed(seed);
    this.flow.reseed(seed ^ 0x9e37);
  }

  /** 发射一批微粒。`allowance` 0..1 用于按预算削减装饰。 */
  public emit(p: EmitParams, allowance = 1): number {
    const n = Math.max(0, Math.round(p.count * allowance));
    for (let i = 0; i < n; i += 1) {
      if (this.particles.length >= this.baseCap) {
        // FIFO 逐出最老的：不让整片突然消失
        const old = this.particles.shift();
        if (old) this.free.push(old);
      }
      let q = this.free.pop();
      if (!q) {
        q = { x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 1, tint: 0xffffff };
      }
      const a = p.angle + (this.rng.float() - 0.5) * 2 * p.spread;
      const sp = this.rng.real(p.speedMin, p.speedMax);
      q.x = p.x;
      q.y = p.y;
      q.vx = Math.cos(a) * sp;
      q.vy = Math.sin(a) * sp;
      q.maxLife = this.rng.real(p.lifeMin, p.lifeMax);
      q.life = q.maxLife;
      q.size = this.rng.real(p.sizeMin, p.sizeMax);
      q.tint = p.tint;
      this.particles.push(q);
    }
    return n;
  }

  /**
   * 推进一帧。
   * 运动模型（规格 §D1）：
   *   v ← v + (涡旋 + 浮升) × dt
   *   v ← v × exp(-drag × dt)     ← 不是逐帧固定乘 0.98
   *   p ← p + v × dt
   */
  public update(dt: number, drag = 2): void {
    if (!(dt > 0)) return;
    this.flow.advance(dt);
    const decay = Math.exp(-drag * dt);
    const buoy = this.flow.cfg.buoyancy;
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const q = this.particles[i];
      q.life -= dt;
      if (q.life <= 0) {
        this.particles.splice(i, 1);
        this.free.push(q);
        continue;
      }
      const a = this.flow.sampleAccel(q.x, q.y);
      q.vx += a.ax * dt;
      q.vy += a.ay * dt;
      q.vy -= buoy * dt; // 浮升：负 y 为向上
      q.vx *= decay;
      q.vy *= decay;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
  }

  /** 单颗粒子的寿命权重（淡入淡出，自然淡到 0，不突然消失）。 */
  public lifeWeight(q: VaporParticle): number {
    const t = q.life / q.maxLife;
    if (t >= 1) return 1;
    // 末尾 30% 平滑淡出
    const tail = 0.3;
    return t > tail ? 1 : t / tail;
  }

  public get activeCount(): number {
    return this.particles.length;
  }

  public clear(): void {
    this.free.push(...this.particles);
    this.particles.length = 0;
  }
}

/**
 * 密度 → 不透明度映射。
 *
 * `alpha = 1 - exp(-k·D)`（Beer–Lambert 形式）：
 *   - 叠加是饱和的，不会线性爆掉；
 *   - 永远 < 1，边缘自然透明 → 满足「无硬切边」；
 *   - 低密度区近似线性，高密度区收敛 → 浓淡层次自然。
 */
export function densityToAlpha(density: number, k = 0.9, maxAlpha = 0.96): number {
  if (!(density > 0)) return 0;
  // 上限必须显式钳制：`1 - exp(-k·D)` 在高密度下会被浮点舍入成恰好 1.0
  // （D=1000 时 exp(-900) 下溢），那就变成了实心白块 —— 正是规格禁止的
  // 「密度截断后靠 Bloom 伪装云层」。留出 0.04 头部给高光/芯。
  const a = 1 - Math.exp(-k * density);
  return a > maxAlpha ? maxAlpha : a;
}

/**
 * 单颗微粒对密度场的贡献权重。
 *
 * 软核（smooth radial falloff 到 0），保证核半径外贡献**精确为 0**——
 * 这是「边缘完全透明、无矩形裁边」的关键：不能有任何硬边界。
 */
export function kernelWeight(dist: number, coreRadius: number): number {
  if (dist >= coreRadius) return 0;
  const t = 1 - dist / coreRadius;
  // smoothstep：中心与边界导数都为 0，叠加时不产生硬环
  return t * t * (3 - 2 * t);
}

/**
 * 累积一颗粒子到密度网格（低分辨率）。
 *
 * `grid` 是扁平数组，`gw/gh` 为分辨率，`cellSize` 为每格世界尺寸。
 * 返回实际触碰的格数，便于调用方判断是否需要裁剪。
 */
export function splatDensity(
  grid: Float32Array,
  gw: number,
  gh: number,
  cellSize: number,
  originX: number,
  originY: number,
  px: number,
  py: number,
  coreRadius: number,
  weight: number,
  coreScale = 3
): number {
  const r = coreRadius * coreScale;
  const cx = (px - originX) / cellSize;
  const cy = (py - originY) / cellSize;
  const cr = r / cellSize;
  const i0 = Math.max(0, Math.floor(cx - cr));
  const i1 = Math.min(gw - 1, Math.ceil(cx + cr));
  const j0 = Math.max(0, Math.floor(cy - cr));
  const j1 = Math.min(gh - 1, Math.ceil(cy + cr));
  let touched = 0;
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const dx = (i + 0.5 - cx) * cellSize;
      const dy = (j + 0.5 - cy) * cellSize;
      const d = Math.hypot(dx, dy);
      const w = kernelWeight(d, r);
      if (w <= 0) continue;
      grid[j * gw + i] += w * weight;
      touched += 1;
    }
  }
  return touched;
}

/** 每帧清空密度网格（热路径用 fill，避免重新分配）。 */
export function clearDensity(grid: Float32Array): void {
  grid.fill(0);
}