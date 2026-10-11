import Phaser from 'phaser';
import { loadGameAssets } from '../utils/AssetLoader';
import { loadProfileFromStorage } from '../state/ProfileState';

/**
 * 加载泵兜底（v0.2.3.1）：Loader 的推进完全依赖 SceneEvents.UPDATE（由 RAF 驱动）。
 * 若页面被系统节流（隐藏 iframe / 后台标签 / 部分移动端省电模式），RAF 停摆 →
 * 队列卡在 POPULATED → complete 永不触发 → 黑屏。
 * 三重保险：
 *  1. window 定时器每 300ms 手动泵一次 Loader.update（幂等，RAF 正常时无副作用）；
 *  2. 12 秒强制收尾：调引擎内建 loadComplete() 清队列放行；
 *  3. 'loaderror' 事件也计入完成，单个资源 404 不再阻塞整体。
 * 遵循「游戏永不阻塞于资源」原则：缺失纹理走降级渲染。
 */
const LOAD_TIMEOUT_SEC = 12;

export class BootScene extends Phaser.Scene {
  private settled = false;

  public constructor() {
    super('BootScene');
  }

  public preload(): void {
    // 等待 HTML 开始界面触发加载
    this.load.on('progress', (value: number) => {
      const pct = Math.round(value * 100);
      try { (window as unknown as { updateLoadProgress?: (pct: number, label: string) => void }).updateLoadProgress?.(pct, `正在加载资源 ${pct}%`); } catch { /* noop */ }
    });
    this.load.on('complete', () => this.settle());
    this.load.on('loaderror', (file: unknown) => {
      console.warn('[BootScene] 资源加载失败，跳过:', (file as { key?: string }).key);
    });
    // 加载泵兜底：window 定时器不受 RAF 节流影响
    const pump = window.setInterval(() => {
      try { (this.load as unknown as { update?: () => void }).update?.(); } catch { /* noop */ }
    }, 300);
    window.setTimeout(() => {
      window.clearInterval(pump);
      this.settle(true);
    }, LOAD_TIMEOUT_SEC * 1000);
    loadGameAssets(this);
  }

  /** 统一收口：complete 与超时都走这里，保证 finishLoad 只调一次。 */
  private settle(timedOut = false): void {
    if (this.settled) return;
    this.settled = true;
    if (timedOut) {
      try {
        (this.load as unknown as { loadComplete?: () => void }).loadComplete?.();
        console.warn('[BootScene] 资源加载超时，已跳过未完成项进入游戏');
      } catch { /* noop */ }
    }
    try { (window as unknown as { finishLoad?: () => void }).finishLoad?.(); } catch { /* noop */ }
  }

  public create(): void {
    const g = this.add.graphics({ x: 0, y: 0 });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(1, 1, 1);
    g.generateTexture('fog-p', 2, 2);
    g.destroy();
    this.createFxTextures();
    // 等 overlay 淡出后再切场景
    this.time.delayedCall(800, () => {
      void loadProfileFromStorage().finally(() => {
        this.scene.start('LobbyScene');
      });
    });
  }

  /**
   * 粒子纹理：全部用 canvas 渐变烘焙柔边，尺寸刻意做小（10~48px）。
   * 相比硬色块几何体，柔边在 ADD 混合下叠加不会出现方块接缝，
   * 小尺寸则保证高密度爆发时单颗粒子不糊成一片。
   * 纯白烘焙 —— 颜色由 FxPool 按调用 setTint，一套纹理覆盖全部配色。
   */
  private createFxTextures(): void {
    const bake = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void => {
      if (this.textures.exists(key)) return;
      const tex = this.textures.createCanvas(key, w, h);
      if (!tex) return;
      const ctx = tex.getContext();
      ctx.clearRect(0, 0, w, h);
      draw(ctx);
      tex.refresh();
    };

    // 主力形状：核心亮、外围三段渐隐的软光点
    bake('fx-spark', 12, 12, (ctx) => {
      const grd = ctx.createRadialGradient(6, 6, 0, 6, 6, 6);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.3, 'rgba(255,255,255,0.9)');
      grd.addColorStop(0.62, 'rgba(255,255,255,0.32)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 12, 12);
    });

    // 更宽更淡的辉光：用于枪口、命中光晕等"照亮周围"的效果
    bake('fx-glow', 24, 24, (ctx) => {
      const grd = ctx.createRadialGradient(12, 12, 0, 12, 12, 12);
      grd.addColorStop(0, 'rgba(255,255,255,0.85)');
      grd.addColorStop(0.45, 'rgba(255,255,255,0.3)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 24, 24);
    });

    // 冲击环：细描边圆，放大淡出即成冲击波
    bake('fx-ring', 48, 48, (ctx) => {
      ctx.filter = 'blur(0.6px)';
      ctx.strokeStyle = 'rgba(255,255,255,1)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(24, 24, 21, 0, Math.PI * 2);
      ctx.stroke();
      ctx.filter = 'none';
    });

    // 碎屑：带软边的小菱形，配合自旋读作"碎片飞溅"
    bake('fx-shard', 10, 10, (ctx) => {
      ctx.filter = 'blur(0.5px)';
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.beginPath();
      ctx.moveTo(5, 0.6);
      ctx.lineTo(9.4, 5);
      ctx.lineTo(5, 9.4);
      ctx.lineTo(0.6, 5);
      ctx.closePath();
      ctx.fill();
      ctx.filter = 'none';
    });
  }
}
