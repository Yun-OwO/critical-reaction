import Phaser from 'phaser';
import { LOAD_PARTICLES } from './Quality';

/**
 * 共享粒子池（移植自参考项目「何忆卫」render/fx.js 的 FxSystem 粒子核心）。
 *
 * 为什么不用引擎自带 ParticleEmitter：本作特效需要**逐粒子**的阻力 + 重力 +
 * 自旋 + 淡入组合来做出"溅射"手感，而引擎发射器的配置是"每次爆发整组一致"，
 * 而且改写配置要么走 updateConfig（重建 op，逐次调用太贵），要么只能覆盖有限字段。
 * 这里按参考项目的成熟方案自建：结构简单、逐粒子可控、且没有任何运行时分配。
 *
 * 三条性能约定（对应参考项目的做法）：
 *  1. **永不 destroy**：粒子精灵建一次就留在容器里，释放只是缩小到 0 并置为透明，
 *     下次从空闲链表取出复用 —— display list 不再反复插拔。
 *  2. **硬上限 + FIFO 逐出**：超过 maxParticles 就淘汰最老的那颗，粒子数在任何
 *     设备上都有确定上界，不会因为连锁反应把帧率打穿。
 *  3. **共享 options 对象**：particle() 不持有传入的选项，调用方通过 opts() 拿到
 *     同一个可变对象、填完即用 —— 每次爆发零对象分配。
 *
 * 装饰性粒子（拖尾、光尘、碎屑）走软上限 SOFT_CAP，只占配额的 75%，
 * 剩下的留给命中/爆发这类玩家真正会盯着看的效果。
 */

/** 装饰性粒子最多占用配额的比例，余量留给命中与爆发。 */
const SOFT_CAP = 0.75;

export interface FxOpts {
  tint?: number;
  vx?: number;
  vy?: number;
  /** 重力（px/s²，正=向下） */
  g?: number;
  /** 阻力系数（每秒衰减比例，1 = 极强） */
  drag?: number;
  /** 寿命（秒） */
  life?: number;
  /** 起始 / 结束缩放 */
  s0?: number;
  s1?: number;
  /** X 轴额外压扁（用于沿速度方向的光痕） */
  sx?: number;
  /** 起始 / 结束不透明度 */
  a0?: number;
  a1?: number;
  /** 自旋角速度（rad/s） */
  spin?: number;
  /** 淡入时长（秒），0 = 无淡入 */
  fadeIn?: number;
  /** 初始朝向（弧度） */
  rot?: number;
  /** 装饰性：只占软上限配额 */
  cosmetic?: boolean;
  // ---- 仅 burst()/sparkCone() 这类高层接口读取 ----
  /** 爆发初速倍率（相对尺寸 s） */
  speed?: number;
  /** 上抛量（等距地面的"掀起"感） */
  up?: number;
  /** 尺寸基准（px，默认 64，用于折算 s0/s1） */
  size?: number;
  /** 覆盖默认粒子纹理 */
  tex?: string;
}

interface FxParticle {
  sp: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  drag: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  sx: number;
  a0: number;
  a1: number;
  spin: number;
  fadeIn: number;
}

/** 粒子纹理键（在 BootScene 里用 canvas 渐变生成，柔边、小尺寸）。 */
export const FX_TEX = {
  spark: 'fx-spark',
  glow: 'fx-glow',
  ring: 'fx-ring',
  shard: 'fx-shard'
} as const;

/** fx-ring 纹理（48×48，描边半径 21px）在 scale=1 时的像素半径，供 ring() 换算缩放。 */
const RING_BASE_R = 21;

export class FxPool {
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Layer;
  /** 活跃粒子（紧致数组，释放时用末位覆盖，保持无空洞） */
  private readonly parts: FxParticle[] = [];
  private readonly free: FxParticle[] = [];
  /** 共享选项对象：particle() 读完即弃，调用方复用同一个 */
  private readonly po: Required<Omit<FxOpts, 'cosmetic' | 'speed' | 'up' | 'size' | 'tex'>> & { cosmetic: boolean };
  /** 光影质量档的粒子基数（来自 visual/quality.ts 的 maxParticles） */
  private baseCap = 800;
  /** 粒子尺寸缩放（低配档整体缩小以降低叠加过绘制） */
  private sizeScale = 1;
  private loadLevel = 0;

  public constructor(scene: Phaser.Scene, depth = 105) {
    this.scene = scene;
    this.layer = scene.add.layer().setDepth(depth);
    this.po = {
      tint: 0xffffff, vx: 0, vy: 0, g: 0, drag: 0, life: 0.5,
      s0: 1, s1: 1, sx: 1, a0: 1, a1: 0, spin: 0, fadeIn: 0, rot: 0, cosmetic: false
    };
  }

  // ---- 配额 -----------------------------------------------------------------------

  /**
   * 同步光影质量档的预算。每帧调用（档位切换即时生效）：
   *  - `baseCap`：同时存活粒子硬上限，来自 VisualProfile.maxParticles；
   *  - `sizeScale`：粒子尺寸缩放，来自 VisualProfile.particleScale —— ADD 混合下
   *    亮度随叠加面积累加，低配档同时**少发**和**发小**才压得住过绘制。
   */
  public setBudget(baseCap: number, sizeScale: number): void {
    this.baseCap = baseCap;
    this.sizeScale = sizeScale;
  }

  public setLoadLevel(level: number): void { this.loadLevel = level; }

  /** 当前粒子硬上限 = 光影质量档基数 × 负载档衰减。 */
  public get maxParticles(): number {
    return Math.round(this.baseCap * (LOAD_PARTICLES[Math.min(3, Math.max(0, this.loadLevel))] ?? 1));
  }

  /** 装饰性粒子是否还有余量（拖尾/光尘等低优先级效果据此自砍）。 */
  public hasCosmeticRoom(): boolean {
    return this.parts.length < this.maxParticles * SOFT_CAP;
  }

  /**
   * 是否有余量做"装饰性细节"（拖尾、二次火花、烟尘、爆发数量翻倍）。
   * 低配档整体关闭，且负载升到 2 档以上也关 —— 这些是玩家最不容易察觉的部分。
   */
  public get rich(): boolean { return this.baseCap > 400 && this.loadLevel < 2; }

  public get activeCount(): number { return this.parts.length; }

  // ---- 选项对象（零分配） ----------------------------------------------------------

  /** 非富余档下把爆发数量砍半（低配档 / 高负载时最先牺牲的就是数量）。 */
  private scaledCount(n: number): number { return this.rich ? n : Math.ceil(n / 2); }

  /** 取共享选项对象并复位。填完直接传给 particle()/burst()，**不要保存引用**。 */
  public opts(): FxPool['po'] {
    const o = this.po;
    o.tint = 0xffffff; o.vx = 0; o.vy = 0; o.g = 0; o.drag = 0; o.life = 0.5;
    o.s0 = 1; o.s1 = 1; o.sx = 1; o.a0 = 1; o.a1 = 0; o.spin = 0; o.fadeIn = 0; o.rot = 0; o.cosmetic = false;
    return o;
  }

  // ---- 核心 -----------------------------------------------------------------------

  /** 发一颗粒子。opts 会被立即读取，调用方可继续复用该对象。 */
  public particle(tex: string, x: number, y: number, o: FxOpts): void {
    const cap = o.cosmetic ? this.maxParticles * SOFT_CAP : this.maxParticles;
    if (this.parts.length >= cap) this.freeOne(this.parts.shift());
    let p = this.free.pop();
    if (!p) {
      const sp = this.scene.add.image(0, 0, tex).setVisible(false);
      this.layer.add(sp);
      p = {
        sp, x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, life: 0, max: 1,
        s0: 1, s1: 1, sx: 1, a0: 1, a1: 0, spin: 0, fadeIn: 0
      };
    }
    const sp = p.sp;
    if (sp.texture.key !== tex) sp.setTexture(tex);
    sp.setVisible(true);
    sp.setPosition(x, y);
    sp.setTint(o.tint ?? 0xffffff);
    sp.setAlpha(o.fadeIn ? 0 : (o.a0 ?? 1));
    sp.setBlendMode(Phaser.BlendModes.ADD);
    sp.setAngle(((o.rot ?? 0) * 180) / Math.PI);

    p.x = x; p.y = y;
    p.vx = o.vx ?? 0; p.vy = o.vy ?? 0;
    p.g = o.g ?? 0; p.drag = o.drag ?? 0;
    p.life = 0; p.max = o.life ?? 0.5;
    // 尺寸乘上档位系数：低配档整体发小一号，直接压低 ADD 混合的叠加过绘制
    const scale = this.sizeScale;
    p.s0 = (o.s0 ?? 1) * scale; p.s1 = (o.s1 ?? o.s0 ?? 1) * scale; p.sx = o.sx ?? 1;
    p.a0 = o.a0 ?? 1; p.a1 = o.a1 ?? 0;
    p.spin = o.spin ?? 0; p.fadeIn = o.fadeIn ?? 0;

    const s0 = p.s0;
    sp.setScale(s0 * p.sx, s0);
    this.parts.push(p);
  }

  private freeOne(p: FxParticle | undefined): void {
    if (!p) return;
    const sp = p.sp;
    sp.setVisible(false).setAlpha(0).setScale(0, 0);
    this.free.push(p);
  }

  // ---- 高层特效 --------------------------------------------------------------------

  /**
   * 全向溅射爆发（近似参考项目的 burst）：
   *  - 初速在 40%~120% 之间随机 —— 让火花呈扇面散开而非整齐的放射线；
   *  - Y 方向 ×0.7 压扁，匹配本作的等距地面投影；
   *  - 阻力 + 重力让轨迹先冲后坠，读起来像真的被溅飞；
   *  - 寿命 ±30%、自旋 ±4rad/s、缩放到近 0，避免"同批同时消失"的机械感。
   */
  public burst(x: number, y: number, s: number, n: number, tint: number, o: Partial<FxOpts> = {}): void {
    const q = this.scaledCount(n);
    const speed = o.speed ?? 2.2;
    const up = o.up ?? 0;
    const g = (o.g ?? 0) * s;
    const life = o.life ?? 0.35;
    const size = (s / 64) * (o.size ?? 0.45);
    for (let i = 0; i < q; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const v = s * speed * (0.4 + Math.random() * 0.8);
      const po = this.opts();
      po.tint = tint;
      po.vx = Math.cos(a) * v;
      po.vy = Math.sin(a) * v * 0.7 - up * s;
      po.drag = 3;
      po.g = g;
      po.life = life * (0.7 + Math.random() * 0.6);
      po.s0 = size;
      po.s1 = (s / 64) * 0.05;
      po.spin = (Math.random() - 0.5) * 8;
      po.cosmetic = o.cosmetic ?? false;
      // 每 3 颗混 1 颗带棱角的碎屑：整批火花里夹杂几片"碎片"，读起来更像被溅飞的实体
      this.particle(o.tex || (i % 3 === 2 ? FX_TEX.shard : FX_TEX.spark), x, y, po);
    }
  }

  /**
   * 锥形溅射（挥砍 / 弹着专用）：初速沿 angle 扇出，配合光痕纹理的 sx 压扁，
   * 火花会顺着刀刃方向甩出去而不是原地炸开。
   */
  public sparkCone(
    x: number, y: number, angle: number, spread: number, n: number, tint: number,
    o: Partial<FxOpts> = {}
  ): void {
    const speed = o.speed ?? 3.4;
    const s = o.size ?? 64;
    const life = o.life ?? 0.24;
    const tex = o.tex || FX_TEX.spark;
    const q = this.scaledCount(n);
    for (let i = 0; i < q; i += 1) {
      const a = angle + (Math.random() - 0.5) * 2 * spread;
      const v = s * speed * (0.35 + Math.random() * 0.95);
      const po = this.opts();
      po.tint = Math.random() < 0.35 ? 0xffffff : tint;
      po.vx = Math.cos(a) * v;
      po.vy = Math.sin(a) * v * 0.7;
      // 长轴是局部 +Y（竖直），屏幕方向 = 90° + rot，所以要对齐飞行方向 a 得减 90°。
      // 用 0°/45°/90°/-45° 四根标尺截图实测确认过该约定，写成 a 会让拖尾垂直于速度。
      po.rot = a - Math.PI / 2;
      po.sx = 0.34;                     // 压成细长条
      po.drag = 3.2;
      po.g = o.g ?? 0;
      po.life = life * (0.6 + Math.random() * 0.9);
      po.s0 = (s / 64) * (0.75 + Math.random() * 0.7);
      po.s1 = (s / 64) * 0.08;
      po.spin = (Math.random() - 0.5) * 5;
      po.cosmetic = o.cosmetic ?? false;
      this.particle(tex, x, y, po);
    }
  }

  /**
   * 冲击环：单颗粒子做 r0 → r1 放大并淡出。
   * 参数是**像素半径**（调用方直觉单位），内部按 fx-ring 纹理的基准半径换算成缩放 ——
   * 比每命中新建 Circle + tween 省掉一对对象与插拔。
   */
  public ring(x: number, y: number, r0: number, r1: number, tint: number, dur = 0.23, a0 = 0.95, cosmetic = false): void {
    const po = this.opts();
    po.tint = tint;
    po.life = dur;
    po.s0 = r0 / RING_BASE_R;
    po.s1 = r1 / RING_BASE_R;
    po.a0 = a0;
    po.a1 = 0;
    po.cosmetic = cosmetic;
    this.particle(FX_TEX.ring, x, y, po);
  }

  // ---- 积分 -------------------------------------------------------------------------

  /** 每帧调用。deltaMs 来自场景 update 的 delta。 */
  public update(deltaMs: number): void {
    const dt = Math.min(deltaMs, 50) / 1000; // 卡顿帧不放大位移，避免粒子瞬移穿屏
    if (dt <= 0) return;
    const list = this.parts;
    let w = 0;
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      p.life += dt;
      if (p.life >= p.max) { this.freeOne(p); continue; }
      if (p.drag > 0) {
        const d = Math.max(0, 1 - p.drag * dt);
        p.vx *= d;
        p.vy *= d;
      }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.life / p.max;
      const sp = p.sp;
      sp.setPosition(p.x, p.y);
      const s = p.s0 + (p.s1 - p.s0) * k;
      sp.setScale(s * p.sx, s);
      if (p.spin !== 0) sp.setAngle(sp.angle + (p.spin * 180 * dt) / Math.PI);
      let a = p.a0 + (p.a1 - p.a0) * k;
      if (p.fadeIn > 0 && p.life < p.fadeIn) a *= p.life / p.fadeIn;
      sp.setAlpha(a < 0 ? 0 : a > 1 ? 1 : a);
      list[w] = p;
      w += 1;
    }
    list.length = w;
  }

  /** 场景结束时清空（精灵由 Layer 随场景销毁，这里只断开引用）。 */
  public clear(): void {
    this.parts.length = 0;
    this.free.length = 0;
  }
}
