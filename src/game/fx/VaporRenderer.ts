/**
 * 逸散光雾的渲染层（T08）
 *
 * 职责分工：
 *   - `VaporField` 拥有微粒的**状态**（位置/速度/寿命/密度），纯逻辑可单测；
 *   - 本类负责把状态**画出来**，并维护一个永不销毁的精灵池。
 *
 * 关键约束（规格 §D1/§D2）：
 *   - 云与微粒**同源**：低分辨率密度场由同一批微粒累积，不是另加几张大云贴图；
 *   - 边缘完全透明：密度场用 `1-exp(-kD)` 且上限 0.96，不会出现硬边白块；
 *   - 关键危险与玩家本体不被装饰遮住（§D3 的保护留由上层决定发射密度）。
 */

import Phaser from 'phaser';
import { FX_TEX } from '../utils/Fx';
import type { VaporField } from './VaporField';

/** 密度网格（世界单位 → 网格）。 */
export interface DensityGridOptions {
  /** 每格世界尺寸 */
  cellSize: number;
  /** 覆盖半径（世界单位），决定网格边长 */
  span: number;
  /** 跟随中心 */
  centerX: number;
  centerY: number;
}

export class VaporRenderer {
  private readonly sprites: Phaser.GameObjects.Image[] = [];
  private readonly layer: Phaser.GameObjects.Layer;
  private grid: Float32Array = new Float32Array(1);
  private gw = 1;
  private gh = 1;
  private cx: number;
  private cy: number;

  public constructor(
    private readonly scene: Phaser.Scene,
    private readonly field: VaporField,
    private readonly opts: DensityGridOptions,
    depth = 106
  ) {
    this.layer = scene.add.layer().setDepth(depth);
    this.cx = opts.centerX;
    this.cy = opts.centerY;
    this.resize(opts);
  }

  /** 网格尺寸随分辨率/覆盖范围确定，热路径只改缓冲不重建。 */
  public resize(opts: DensityGridOptions): void {
    this.cx = opts.centerX;
    this.cy = opts.centerY;
    const n = Math.max(1, Math.ceil((opts.span * 2) / opts.cellSize));
    if (n !== this.gw || n !== this.gh) {
      this.gw = n;
      this.gh = n;
      this.grid = new Float32Array(n * n);
    }
  }

  /**
   * 每帧同步：微粒 → 精灵池，并把微粒累积进密度网格。
   * 精灵**只增不减地预分配**，之后只改位置/缩放/透明度，不做 display list 插拔。
   */
  public sync(zoom: number): void {
    const parts = this.field.particles;
    const need = parts.length;
    while (this.sprites.length < need) {
      const s = this.scene.add.image(0, 0, FX_TEX.spark).setVisible(false);
      this.layer.add(s);
      this.sprites.push(s);
    }
    for (let i = 0; i < this.sprites.length; i += 1) {
      const sp = this.sprites[i];
      const p = parts[i];
      if (!p) {
        if (sp.visible) sp.setVisible(false);
        continue;
      }
      const w = this.field.lifeWeight(p);
      if (!sp.visible) sp.setVisible(true);
      sp.setPosition(p.x, p.y);
      // 粒子直径是 CSS 像素；乘 zoom 换算到世界/屏幕一致
      const px = p.size * zoom;
      sp.setScale(px / 12);
      sp.setTint(p.tint);
      sp.setAlpha(w * 0.9);
    }
  }

  /**
   * 累积密度场。
   * 每颗粒子用软核写入，核半径为可见半径的 3 倍 → 边缘贡献精确为 0。
   */
  public accumulateDensity(coreScale = 3): void {
    this.grid.fill(0);
    const cell = this.opts.cellSize;
    const originX = this.cx - (this.gw * cell) / 2;
    const originY = this.cy - (this.gh * cell) / 2;
    for (const p of this.field.particles) {
      const w = this.field.lifeWeight(p);
      if (w <= 0) continue;
      // 简化的核心 splat：按粒子世界半径换算到格单位
      const r = p.size * 3;
      const cx = (p.x - originX) / cell;
      const cy = (p.y - originY) / cell;
      const cr = r / cell;
      const i0 = Math.max(0, Math.floor(cx - cr));
      const i1 = Math.min(this.gw - 1, Math.ceil(cx + cr));
      const j0 = Math.max(0, Math.floor(cy - cr));
      const j1 = Math.min(this.gh - 1, Math.ceil(cy + cr));
      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1) {
          const dx = (i + 0.5 - cx) * cell;
          const dy = (j + 0.5 - cy) * cell;
          const d = Math.hypot(dx, dy);
          if (d >= r) continue;
          const t = 1 - d / r;
          this.grid[j * this.gw + i] += t * t * (3 - 2 * t) * w;
        }
      }
    }
    void coreScale;
  }

  /** 只读访问密度场，供 T05/T06 的合成层上传纹理。 */
  public get density(): Float32Array {
    return this.grid;
  }

  public get gridSize(): { gw: number; gh: number } {
    return { gw: this.gw, gh: this.gh };
  }

  public setVisible(v: boolean): void {
    this.layer.setVisible(v);
  }

  public destroy(): void {
    for (const s of this.sprites) s.destroy();
    this.sprites.length = 0;
    this.layer.destroy();
  }
}