/**
 * 电子轨道生命核心（设计文档 §14.3）
 *
 * 把「电子即生命」这一核心支柱变成一眼可读的 HUD：
 *   - 中心原子核：当前染料/模式色，中心大号数字 = 价电子数
 *   - 价电子轨道：2.5D 椭圆轨道上排布价电子；存活为发光实心，失去为空心剪影
 *   - 护盾环：外层金色弧，按护盾值比例绘制
 *   - 自由电子：内层青色卫星点
 *
 * 几何计算全部抽为纯函数，便于单测；渲染层只做位置/颜色更新，不每帧创建对象。
 */

import Phaser from 'phaser';
import { getVisualProfile } from '../visual/quality';
import {
  ORBIT_TILT,
  shieldArcRatio,
  valenceElectronPositions,
  freeElectronPositions
} from './electronCoreGeometry';
import type { ElectronDot } from './electronCoreGeometry';

export type { ElectronDot };
export {
  ORBIT_TILT,
  MAX_VALENCE_DOTS,
  MAX_FREE_DOTS,
  SHIELD_FULL,
  valenceElectronPositions,
  freeElectronPositions,
  shieldArcRatio
} from './electronCoreGeometry';

export interface ElectronCoreState {
  valence: number;
  maxValence: number;
  shieldHp: number;
  freeElectrons: number;
  /** 原子核颜色（染料/模式色） */
  coreColor: number;
  /** 轨道环颜色 */
  ringColor: number;
  /** 过载：温度超限（BALANCE.overload.tempThreshold），卫星点转红急促闪烁 */
  overload?: boolean;
}

/**
 * 电子轨道生命核心组件。
 * 生命周期内不销毁重建子对象；每帧只更新位置、颜色与透明度。
 */
export class ElectronCoreWidget {
  private readonly scene: Phaser.Scene;
  private readonly cx: number;
  private readonly cy: number;
  private readonly r: number;
  private readonly glowLayers: number;

  private readonly glowRings: Phaser.GameObjects.Arc[] = [];
  private readonly orbitRing: Phaser.GameObjects.Arc;
  private readonly shieldArc: Phaser.GameObjects.Graphics;
  /** 价电子的光晕层与本体，两层一一对应。 */
  private readonly dotGlows: Phaser.GameObjects.Arc[] = [];
  private readonly dots: Phaser.GameObjects.Arc[] = [];
  private readonly freeDots: Phaser.GameObjects.Arc[] = [];
  private readonly nucleus: Phaser.GameObjects.Arc;
  private readonly nucleusHi: Phaser.GameObjects.Arc;
  private readonly countText: Phaser.GameObjects.Text;
  private readonly maxText: Phaser.GameObjects.Text;
  private readonly freeLabel: Phaser.GameObjects.Text;
  private phase = 0;
  private freePhase = 0;

  public constructor(scene: Phaser.Scene, cx: number, cy: number, radius: number) {
    this.scene = scene;
    this.cx = cx;
    this.cy = cy;
    this.r = radius;
    this.glowLayers = Math.max(1, getVisualProfile().glowLayers);
    const depth = 12;

    // 外层多层辉光环：层数由视觉质量档决定（低 1 / 中 3 / 高 4）
    for (let i = this.glowLayers - 1; i >= 0; i -= 1) {
      const spread = radius + (i + 1) * 3.2;
      const ring = scene.add.circle(cx, cy, spread, 0x67e8f9, 0)
        .setStrokeStyle(2.4, 0x67e8f9, 0.16 - i * 0.03)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(depth - 1);
      ring.setScale(1, ORBIT_TILT);
      this.glowRings.push(ring);
    }

    // 价电子轨道（细实线椭圆）
    this.orbitRing = scene.add.circle(cx, cy, radius, 0x67e8f9, 0)
      .setStrokeStyle(1.2, 0x9fd8e8, 0.45)
      .setDepth(depth);
    this.orbitRing.setScale(1, ORBIT_TILT);

    // 护盾环（金色弧，按护盾值绘制）
    this.shieldArc = scene.add.graphics().setDepth(depth + 1);

    // 原子核
    this.nucleus = scene.add.circle(cx, cy, radius * 0.42, 0x67e8f9, 0.9).setDepth(depth + 2);
    this.nucleusHi = scene.add.circle(cx - radius * 0.12, cy - radius * 0.14, radius * 0.17, 0xffffff, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(depth + 3);

    this.countText = scene.add.text(cx, cy, '', {
      color: '#FFFFFF', fontFamily: 'monospace', fontSize: `${Math.round(radius * 0.62)}px`, fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(depth + 4);
    this.maxText = scene.add.text(cx + radius * 0.52, cy + radius * 0.42, '', {
      color: '#9FD8E8', fontFamily: 'monospace', fontSize: `${Math.round(radius * 0.3)}px`
    }).setOrigin(0.5).setDepth(depth + 4);
    this.freeLabel = scene.add.text(cx, cy + radius * ORBIT_TILT + radius * 0.55, '自由电子', {
      color: '#67E8F9', fontFamily: 'monospace', fontSize: `${Math.round(radius * 0.26)}px`
    }).setOrigin(0.5, 0).setDepth(depth + 4).setAlpha(0.75);
  }

  /** 每帧更新：orbit 缓慢自转（dt 秒），电子位置由纯函数推导。 */
  public refresh(state: ElectronCoreState, dt: number): void {
    this.phase += dt * 0.55;
    this.freePhase -= dt * 1.1;
    const profile = getVisualProfile();

    // 轨道环与辉光跟随模式色
    this.orbitRing.setStrokeStyle(1.2, state.ringColor, 0.45);
    this.glowRings.forEach((ring) => ring.setStrokeStyle(2.4, state.ringColor, 0.16));

    // 价电子
    const dots = valenceElectronPositions(state.valence, state.maxValence, this.r, this.phase);
    this.ensureDotCapacity(dots.length);
    const dotR = Math.max(2.6, this.r * 0.13);
    dots.forEach((dot, i) => {
      const arc = this.dots[i];
      const glow = this.dotGlows[i];
      const px = this.cx + dot.x;
      const py = this.cy + dot.y;
      arc.setVisible(true).setPosition(px, py);
      glow.setVisible(true).setPosition(px, py);
      if (dot.active) {
        arc.setRadius(dotR).setFillStyle(0xffffff, 1).setStrokeStyle(1.6, state.ringColor, 1);
        glow.setRadius(dotR * 2.1).setFillStyle(state.ringColor, profile.glowAlpha * 0.4);
        glow.setScale(1 + 0.18 * Math.sin(this.phase * 2 + i));
      } else {
        // 失去的价电子：空心剪影，让"缺了几颗"一眼可见
        arc.setRadius(dotR * 0.82).setFillStyle(0x0b1e2d, 0.85).setStrokeStyle(1.2, state.ringColor, 0.28);
        glow.setVisible(false);
      }
    });

    // 自由电子卫星
    const freeDots = freeElectronPositions(state.freeElectrons, this.r * 0.62, this.freePhase);
    const freeR = Math.max(2.2, this.r * 0.1);
    // 过载：卫星转红急促闪烁（"温度正在烧你"必须一眼可见）
    const overFlash = state.overload ? 0.5 + 0.5 * Math.sin(this.phase * 9) : 0;
    this.ensureFreeCapacity(freeDots.length);
    freeDots.forEach((dot, i) => {
      const arc = this.freeDots[i];
      arc.setVisible(true).setPosition(this.cx + dot.x, this.cy + dot.y)
        .setRadius(freeR);
      if (state.overload) {
        arc.setFillStyle(0xff5c7a, 1).setStrokeStyle(1.4, 0xffd7de, overFlash);
      } else {
        arc.setFillStyle(0x67e8f9, 1).setStrokeStyle(1.4, 0xe0f2fe, 1);
      }
    });

    // 护盾弧
    this.shieldArc.clear();
    const ratio = shieldArcRatio(state.shieldHp);
    if (ratio > 0) {
      const arcR = this.r + 7;
      this.shieldArc.lineStyle(3, 0xfde047, 0.9);
      this.shieldArc.beginPath();
      this.shieldArc.arc(this.cx, this.cy, arcR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio, false);
      this.shieldArc.strokePath();
    }

    // 原子核与数字
    this.nucleus.setFillStyle(state.coreColor, 0.9);
    this.countText.setText(String(Math.max(0, Math.round(state.valence))));
    const label = `${Math.max(0, Math.round(state.maxValence))}`;
    if (this.maxText.text !== `/${label}`) this.maxText.setText(`/${label}`);
    this.maxText.setColor(`#${state.ringColor.toString(16).padStart(6, '0')}`);
    this.freeLabel.setColor(`#${state.ringColor.toString(16).padStart(6, '0')}`);
  }

  private ensureDotCapacity(need: number): void {
    const profile = getVisualProfile();
    while (this.dots.length < need) {
      const glow = this.scene.add.circle(this.cx, this.cy, 6, 0x67e8f9, profile.glowAlpha * 0.35)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(11);
      const arc = this.scene.add.circle(this.cx, this.cy, 3, 0xffffff, 1).setDepth(13);
      this.dotGlows.push(glow);
      this.dots.push(arc);
    }
    // 多余的隐藏而非销毁（上限受 MAX_VALENCE_DOTS 约束，数量恒定）
    for (let i = need; i < this.dots.length; i += 1) {
      this.dots[i].setVisible(false);
      this.dotGlows[i].setVisible(false);
    }
  }

  private ensureFreeCapacity(need: number): void {
    while (this.freeDots.length < need) {
      this.freeDots.push(this.scene.add.circle(this.cx, this.cy, 2.4, 0x67e8f9, 1).setDepth(13));
    }
    for (let i = need; i < this.freeDots.length; i += 1) this.freeDots[i].setVisible(false);
  }
}